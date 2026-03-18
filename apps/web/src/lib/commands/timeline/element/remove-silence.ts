import { Command } from "@/lib/commands/base-command";
import type { TimelineTrack } from "@/types/timeline";
import { EditorCore } from "@/core";
import {
	detectSilence,
	type AudioSegment,
	type SilenceDetectionOptions,
} from "@/lib/silence-detection";
import { decodeAudioToFloat32 } from "@/lib/media/audio";
import { canElementHaveAudio } from "@/lib/timeline/element-utils";
import { mediaSupportsAudio } from "@/lib/media/media-utils";

/**
 * Removes silent portions from audio/video elements on the timeline.
 *
 * For each element that has audio, we decode its audio, detect silent
 * segments, then split the element so only audible parts remain —
 * rippled together to close the gaps.
 */
export class RemoveSilenceCommand extends Command {
	private savedState: TimelineTrack[] | null = null;
	private previousSelection: { trackId: string; elementId: string }[] = [];
	private options: SilenceDetectionOptions;
	private elements: { trackId: string; elementId: string }[];
	private ready = false;

	constructor({
		elements,
		options = {},
	}: {
		elements: { trackId: string; elementId: string }[];
		options?: SilenceDetectionOptions;
	}) {
		super();
		this.elements = elements;
		this.options = options;
	}

	/**
	 * Must be called before execute() because audio decoding is async
	 * and Command.execute() is synchronous.
	 */
	async prepare(): Promise<void> {
		const editor = EditorCore.getInstance();
		const tracks = editor.timeline.getTracks();
		const mediaAssets = editor.media.getAssets();
		const mediaMap = new Map(mediaAssets.map((a) => [a.id, a]));

		this.savedState = tracks;
		this.previousSelection = editor.selection.getSelectedElements();

		let updatedTracks = [...tracks.map((t) => ({ ...t, elements: [...t.elements] }))];

		for (const { trackId, elementId } of this.elements) {
			const trackIndex = updatedTracks.findIndex((t) => t.id === trackId);
			if (trackIndex === -1) continue;
			const track = updatedTracks[trackIndex];
			const element = track.elements.find((e) => e.id === elementId);
			if (!element || !canElementHaveAudio(element)) continue;

			// Resolve the audio file
			let audioBlob: Blob | null = null;

			if (element.type === "audio" && element.sourceType === "upload") {
				const asset = mediaMap.get(element.mediaId);
				if (asset) audioBlob = asset.file;
			} else if (element.type === "audio" && element.sourceType === "library") {
				try {
					const resp = await fetch(element.sourceUrl);
					if (resp.ok) audioBlob = await resp.blob();
				} catch { /* skip */ }
			} else if (element.type === "video") {
				const asset = mediaMap.get(element.mediaId);
				if (asset && mediaSupportsAudio({ media: asset })) {
					audioBlob = asset.file;
				}
			}

			if (!audioBlob) continue;

			const { samples, sampleRate } = await decodeAudioToFloat32({
				audioBlob,
			});

			const { audibleParts } = detectSilence({
				samples,
				sampleRate,
				...this.options,
			});

			if (audibleParts.length === 0) continue;

			// Map audible segments back to the element's visible region
			const elementAudible = mapAudibleToElement({
				audibleParts,
				element: {
					startTime: element.startTime,
					duration: element.duration,
					trimStart: element.trimStart,
				},
			});

			if (elementAudible.length <= 1) continue; // nothing to remove

			// Replace the original element with trimmed copies, rippled together
			const newElements = track.elements.filter((e) => e.id !== elementId);
			let cursor = element.startTime;

			for (const seg of elementAudible) {
				const segDuration = seg.endTime - seg.startTime;
				newElements.push({
					...element,
					id: `${element.id}-sr-${Math.random().toString(36).slice(2, 8)}`,
					startTime: cursor,
					duration: segDuration,
					trimStart: seg.startTime,
					trimEnd:
						(element.sourceDuration ?? element.trimStart + element.duration + element.trimEnd) -
						seg.startTime -
						segDuration,
					name: element.name,
				});
				cursor += segDuration;
			}

			// Sort by startTime
			newElements.sort((a, b) => a.startTime - b.startTime);

			updatedTracks[trackIndex] = {
				...track,
				elements: newElements,
			} as TimelineTrack;
		}

		this.savedState = tracks;
		// Store the computed result so execute() can apply it synchronously
		this._computedTracks = updatedTracks as TimelineTrack[];
		this.ready = true;
	}

	private _computedTracks: TimelineTrack[] | null = null;

	execute(): void {
		if (!this.ready || !this._computedTracks) {
			throw new Error("RemoveSilenceCommand.prepare() must be called before execute()");
		}
		const editor = EditorCore.getInstance();
		if (!this.savedState) {
			this.savedState = editor.timeline.getTracks();
		}
		editor.timeline.updateTracks(this._computedTracks);
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
}

/**
 * Maps absolute audible segments to the visible window of a timeline element,
 * returning segments expressed as source-time offsets (for trimStart).
 */
function mapAudibleToElement({
	audibleParts,
	element,
}: {
	audibleParts: AudioSegment[];
	element: { startTime: number; duration: number; trimStart: number };
}): AudioSegment[] {
	const sourceStart = element.trimStart;
	const sourceEnd = element.trimStart + element.duration;

	const mapped: AudioSegment[] = [];
	for (const part of audibleParts) {
		const overlapStart = Math.max(part.startTime, sourceStart);
		const overlapEnd = Math.min(part.endTime, sourceEnd);
		if (overlapStart < overlapEnd) {
			mapped.push({ startTime: overlapStart, endTime: overlapEnd });
		}
	}
	return mapped;
}
