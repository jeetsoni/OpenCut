import { Command } from "@/lib/commands/base-command";
import type { TimelineTrack } from "@/types/timeline";
import { EditorCore } from "@/core";
import { detectSilence, type SilenceDetectionOptions } from "@/lib/silence-detection";
import {
	transcribeSegments,
	analyzeRetakes,
	type RetakeDetectionProgress,
	type TranscribedSegment,
} from "@/lib/retake-detection";
import { decodeAudioToFloat32 } from "@/lib/media/audio";
import { canElementHaveAudio } from "@/lib/timeline/element-utils";
import { mediaSupportsAudio } from "@/lib/media/media-utils";
import { useRetakesStore, type RemovedRetakeSegment } from "@/stores/retakes-store";

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Removes retake/stuttered segments from audio/video elements.
 *
 * Groups elements by source media so we decode audio once per source,
 * transcribe all segments, then make a SINGLE LLM call to identify retakes.
 */
export class RemoveRetakesCommand extends Command {
	private savedState: TimelineTrack[] | null = null;
	private previousSelection: { trackId: string; elementId: string }[] = [];
	private elements: { trackId: string; elementId: string }[];
	private silenceOptions: SilenceDetectionOptions;
	private onProgress?: (progress: RetakeDetectionProgress) => void;
	private ready = false;
	private _computedTracks: TimelineTrack[] | null = null;
	private _removedSegments: RemovedRetakeSegment[] = [];
	private _recordId: string | null = null;

	constructor({
		elements,
		silenceOptions = {},
		onProgress,
	}: {
		elements: { trackId: string; elementId: string }[];
		silenceOptions?: SilenceDetectionOptions;
		onProgress?: (progress: RetakeDetectionProgress) => void;
	}) {
		super();
		this.elements = elements;
		this.silenceOptions = silenceOptions;
		this.onProgress = onProgress;
	}

	async prepare(): Promise<void> {
		const editor = EditorCore.getInstance();
		const tracks = editor.timeline.getTracks();
		const mediaAssets = editor.media.getAssets();
		const mediaMap = new Map(mediaAssets.map((a) => [a.id, a]));

		this.savedState = tracks;
		this.previousSelection = editor.selection.getSelectedElements();

		// Resolve each element to its source audio blob + mediaId
		const resolvedElements: {
			trackId: string;
			elementId: string;
			audioBlob: Blob;
			mediaId: string;
		}[] = [];

		for (const { trackId, elementId } of this.elements) {
			const track = tracks.find((t) => t.id === trackId);
			if (!track) continue;
			const element = track.elements.find((e) => e.id === elementId);
			if (!element || !canElementHaveAudio(element)) continue;

			let audioBlob: Blob | null = null;
			let resolvedMediaId = elementId;

			if (element.type === "audio" && element.sourceType === "upload") {
				const asset = mediaMap.get(element.mediaId);
				if (asset) audioBlob = asset.file;
				resolvedMediaId = element.mediaId;
			} else if (element.type === "audio" && element.sourceType === "library") {
				try {
					const resp = await fetch(element.sourceUrl);
					if (resp.ok) audioBlob = await resp.blob();
				} catch { /* skip */ }
				resolvedMediaId = element.sourceUrl;
			} else if (element.type === "video") {
				const asset = mediaMap.get(element.mediaId);
				if (asset && mediaSupportsAudio({ media: asset })) {
					audioBlob = asset.file;
				}
				resolvedMediaId = element.mediaId;
			}

			if (audioBlob) {
				resolvedElements.push({ trackId, elementId, audioBlob, mediaId: resolvedMediaId });
			}
		}

		if (resolvedElements.length === 0) {
			this._computedTracks = tracks as TimelineTrack[];
			this.ready = true;
			return;
		}

		// Group by mediaId so we decode + transcribe + LLM once per source
		const byMedia = new Map<string, typeof resolvedElements>();
		for (const el of resolvedElements) {
			const group = byMedia.get(el.mediaId) ?? [];
			group.push(el);
			byMedia.set(el.mediaId, group);
		}

		const updatedTracks = [...tracks.map((t) => ({ ...t, elements: [...t.elements] }))];

		for (const [mediaId, group] of byMedia) {
			// Decode audio once for this source
			const audioBlob = group[0].audioBlob;
			const { samples, sampleRate } = await decodeAudioToFloat32({ audioBlob });

			// Compute the union of source ranges actually used in the timeline
			const usedRanges = group.map(({ trackId, elementId }) => {
				const track = tracks.find((t) => t.id === trackId);
				const element = track?.elements.find((e) => e.id === elementId);
				if (!element) return null;
				return { start: element.trimStart, end: element.trimStart + element.duration };
			}).filter(Boolean) as { start: number; end: number }[];

			// Detect silence on the full source audio
			const { audibleParts } = detectSilence({
				samples,
				sampleRate,
				...this.silenceOptions,
			});

			if (audibleParts.length <= 1) continue;

			// Only transcribe segments that overlap with clips still in the timeline
			const relevantParts = audibleParts.filter((seg) =>
				usedRanges.some(
					(range) => seg.startTime < range.end && seg.endTime > range.start,
				),
			);

			if (relevantParts.length <= 1) continue;

			// Transcribe only the relevant segments
			const transcribed = await transcribeSegments({
				audioBlob,
				segments: relevantParts,
				mediaId,
				onProgress: this.onProgress,
			});

			// Single LLM call for this source
			this.onProgress?.({
				phase: "analyzing",
				current: 0,
				total: 1,
				message: "Analyzing transcriptions with AI...",
			});

			const keepIndices = await analyzeRetakes({ transcribed });

			if (keepIndices.length === 0 || keepIndices.length === relevantParts.length) continue;

			const keptSegments = keepIndices
				.sort((a, b) => a - b)
				.map((idx) => relevantParts[idx])
				.filter(Boolean);

			// Track removed segments (indices not in keepIndices)
			const removedIndices = relevantParts
				.map((_, idx) => idx)
				.filter((idx) => !keepIndices.includes(idx));

			const removedPartsWithTranscript = removedIndices.map((idx) => ({
				segment: relevantParts[idx],
				transcript: transcribed[idx],
			}));

			// Apply to every element in this group
			for (const { trackId, elementId } of group) {
				const trackIndex = updatedTracks.findIndex((t) => t.id === trackId);
				if (trackIndex === -1) continue;
				const track = updatedTracks[trackIndex];
				const element = track.elements.find((e) => e.id === elementId);
				if (!element) continue;

				const sourceStart = element.trimStart;
				const sourceEnd = element.trimStart + element.duration;

				// Record removed segments for this element
				for (const { segment, transcript } of removedPartsWithTranscript) {
					const overlapStart = Math.max(segment.startTime, sourceStart);
					const overlapEnd = Math.min(segment.endTime, sourceEnd);
					if (overlapStart >= overlapEnd) continue;

					const segDuration = overlapEnd - overlapStart;
					// Calculate where this segment was on the timeline
					const timelineOffset = overlapStart - sourceStart;
					const timelineStart = element.startTime + timelineOffset;

					this._removedSegments.push({
						id: `removed-${Math.random().toString(36).slice(2, 8)}`,
						trackId,
						originalElementId: elementId,
						sourceStart: overlapStart,
						sourceEnd: overlapEnd,
						timelineStart,
						duration: segDuration,
						transcript: transcript.text,
						label: `${formatTime(timelineStart)} – ${formatTime(timelineStart + segDuration)} (${segDuration.toFixed(1)}s)`,
					});
				}

				const newElements = track.elements.filter((e) => e.id !== elementId);
				let cursor = element.startTime;

				for (const seg of keptSegments) {
					const overlapStart = Math.max(seg.startTime, sourceStart);
					const overlapEnd = Math.min(seg.endTime, sourceEnd);
					if (overlapStart >= overlapEnd) continue;

					const segDuration = overlapEnd - overlapStart;
					newElements.push({
						...element,
						id: `${element.id}-rt-${Math.random().toString(36).slice(2, 8)}`,
						startTime: cursor,
						duration: segDuration,
						trimStart: overlapStart,
						trimEnd:
							(element.sourceDuration ?? element.trimStart + element.duration + element.trimEnd) -
							overlapStart -
							segDuration,
						name: element.name,
					});
					cursor += segDuration;
				}

				newElements.sort((a, b) => a.startTime - b.startTime);
				updatedTracks[trackIndex] = { ...track, elements: newElements } as TimelineTrack;
			}
		}

		this._computedTracks = updatedTracks as TimelineTrack[];
		this.ready = true;
	}

	execute(): void {
		if (!this.ready || !this._computedTracks) {
			throw new Error("RemoveRetakesCommand.prepare() must be called before execute()");
		}
		const editor = EditorCore.getInstance();
		if (!this.savedState) {
			this.savedState = editor.timeline.getTracks();
		}
		editor.timeline.updateTracks(this._computedTracks);

		// Store removal record for review/restore functionality
		if (this._removedSegments.length > 0) {
			this._recordId = `retakes-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
			useRetakesStore.getState().addRemovalRecord({
				id: this._recordId,
				timestamp: Date.now(),
				tracksBefore: this.savedState,
				tracksAfter: this._computedTracks,
				removedSegments: this._removedSegments,
			});
		}
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
			editor.selection.setSelectedElements({
				elements: this.previousSelection,
			});
		}
	}

	/** Get the record ID for this removal operation */
	getRecordId(): string | null {
		return this._recordId;
	}

	/** Get the removed segments */
	getRemovedSegments(): RemovedRetakeSegment[] {
		return this._removedSegments;
	}
}
