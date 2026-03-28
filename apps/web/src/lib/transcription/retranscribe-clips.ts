/**
 * Re-transcribe selected timeline clips and merge the new words
 * back into the existing project transcript.
 *
 * This is useful when the initial full-timeline transcription
 * produced incomplete or inaccurate words for specific clips
 * (common for the last clip or very short segments).
 */

import {
	collectAudioElements,
	createAudioContext,
	type CollectedAudioElement,
} from "@/lib/media/audio";
import { generateTranscript } from "@/lib/transcription/generate-transcript";
import type { TranscriptGenerationProgress } from "@/lib/transcription/generate-transcript";
import type { MediaAsset } from "@/types/assets";
import type {
	TimelineElement,
	TimelineTrack,
} from "@/types/timeline";
import type {
	ProjectTranscript,
	TranscriptionWord,
	TranscriptionSegment,
} from "@/types/transcription";

/**
 * Extract audio for specific elements, transcribe them, and merge
 * the resulting words/segments into the existing transcript.
 *
 * For each selected element we:
 * 1. Build a temporary single-element track so `collectAudioElements`
 *    decodes just that clip's source audio.
 * 2. Mix it into a buffer covering the element's timeline span.
 * 3. Transcribe the isolated audio.
 * 4. Offset the returned word timestamps to the element's `startTime`.
 * 5. Splice the new words into the existing transcript, replacing any
 *    words that fall within the element's time range.
 */
export async function retranscribeClips({
	elements,
	tracks,
	mediaAssets,
	existingTranscript,
	onProgress,
}: {
	elements: TimelineElement[];
	tracks: TimelineTrack[];
	mediaAssets: MediaAsset[];
	existingTranscript: ProjectTranscript | null;
	onProgress?: (progress: TranscriptGenerationProgress) => void;
}): Promise<ProjectTranscript> {
	const sampleRate = 44100;
	const audioContext = createAudioContext({ sampleRate });

	try {
		// Collect all new words/segments across selected elements
		const newWords: TranscriptionWord[] = [];
		const newSegments: TranscriptionSegment[] = [];

		// Build a set of time ranges we're replacing
		const replaceRanges: Array<{ start: number; end: number }> = [];

		for (let idx = 0; idx < elements.length; idx++) {
			const element = elements[idx];
			const clipStart = element.startTime;
			const clipEnd = element.startTime + element.duration;

			replaceRanges.push({ start: clipStart, end: clipEnd });

			onProgress?.({
				phase: "extracting",
				current: idx + 1,
				total: elements.length,
				message: `Extracting audio for clip ${idx + 1}/${elements.length}...`,
			});

			// Find the track this element belongs to so we can build
			// a temporary single-element track with the correct type
			const parentTrack = tracks.find((t) =>
				t.elements.some((e) => e.id === element.id),
			);
			if (!parentTrack) continue;

			const tempTrack: TimelineTrack = {
				...parentTrack,
				muted: false,
				elements: [element],
			};

			const audioElements = await collectAudioElements({
				tracks: [tempTrack],
				mediaAssets,
				audioContext,
			});

			if (audioElements.length === 0) continue;

			// Mix into a buffer covering just this clip's duration
			const clipDuration = element.duration;
			const outputLength = Math.ceil(clipDuration * sampleRate);
			const outputBuffer = audioContext.createBuffer(2, outputLength, sampleRate);

			for (const ae of audioElements) {
				// Shift the element to start at 0 in our local buffer
				const shifted: CollectedAudioElement = {
					...ae,
					startTime: 0,
				};
				mixAudioChannelsLocal({
					element: shifted,
					outputBuffer,
					outputLength,
					sampleRate,
				});
			}

			// Mix down to mono Float32
			const length = outputBuffer.length;
			const numChannels = outputBuffer.numberOfChannels;
			const samples = new Float32Array(length);
			for (let i = 0; i < length; i++) {
				let sum = 0;
				for (let ch = 0; ch < numChannels; ch++) {
					sum += outputBuffer.getChannelData(ch)[i];
				}
				samples[i] = sum / numChannels;
			}

			// Transcribe the isolated clip
			const clipTranscript = await generateTranscript({
				samples,
				sampleRate,
				onProgress: (p) => {
					onProgress?.({
						...p,
						message: `Clip ${idx + 1}/${elements.length}: ${p.message}`,
					});
				},
			});

			// Offset words/segments to the clip's timeline position
			for (const w of clipTranscript.words) {
				newWords.push({
					word: w.word,
					start: w.start + clipStart,
					end: w.end + clipStart,
				});
			}
			for (const s of clipTranscript.segments) {
				newSegments.push({
					text: s.text,
					start: s.start + clipStart,
					end: s.end + clipStart,
				});
			}
		}

		onProgress?.({
			phase: "merging",
			current: elements.length,
			total: elements.length,
			message: "Merging transcript...",
		});

		// Merge: keep existing words outside the replace ranges,
		// substitute with new words inside the ranges
		return mergeTranscript({
			existingTranscript,
			newWords,
			newSegments,
			replaceRanges,
		});
	} finally {
		void audioContext.close();
	}
}

/**
 * Local copy of mixAudioChannels (the one in audio.ts is not exported).
 */
function mixAudioChannelsLocal({
	element,
	outputBuffer,
	outputLength,
	sampleRate,
}: {
	element: CollectedAudioElement;
	outputBuffer: AudioBuffer;
	outputLength: number;
	sampleRate: number;
}): void {
	const {
		buffer,
		startTime,
		trimStart,
		duration: elementDuration,
		volume = 1,
	} = element;

	const sourceStartSample = Math.floor(trimStart * buffer.sampleRate);
	const sourceLengthSamples = Math.floor(elementDuration * buffer.sampleRate);
	const outputStartSample = Math.floor(startTime * sampleRate);

	const resampleRatio = sampleRate / buffer.sampleRate;
	const resampledLength = Math.floor(sourceLengthSamples * resampleRatio);

	const outputChannels = 2;
	for (let channel = 0; channel < outputChannels; channel++) {
		const outputData = outputBuffer.getChannelData(channel);
		const sourceChannel = Math.min(channel, buffer.numberOfChannels - 1);
		const sourceData = buffer.getChannelData(sourceChannel);

		for (let i = 0; i < resampledLength; i++) {
			const outputIndex = outputStartSample + i;
			if (outputIndex >= outputLength) break;

			const sourceIndex = sourceStartSample + Math.floor(i / resampleRatio);
			if (sourceIndex >= sourceData.length) break;

			outputData[outputIndex] += sourceData[sourceIndex] * volume;
		}
	}
}

/**
 * Merge new words into an existing transcript, replacing any words
 * that overlap with the given time ranges.
 */
function mergeTranscript({
	existingTranscript,
	newWords,
	newSegments,
	replaceRanges,
}: {
	existingTranscript: ProjectTranscript | null;
	newWords: TranscriptionWord[];
	newSegments: TranscriptionSegment[];
	replaceRanges: Array<{ start: number; end: number }>;
}): ProjectTranscript {
	if (!existingTranscript) {
		// No existing transcript — just return the new words
		const text = newWords.map((w) => w.word).join(" ");
		const duration =
			newWords.length > 0 ? newWords[newWords.length - 1].end : 0;
		return {
			text,
			duration,
			words: newWords,
			segments: newSegments,
			createdAt: new Date().toISOString(),
		};
	}

	// Filter out existing words that fall within any replace range
	const keptWords = existingTranscript.words.filter((w) => {
		const wordMid = (w.start + w.end) / 2;
		return !replaceRanges.some(
			(r) => wordMid >= r.start && wordMid < r.end,
		);
	});

	const keptSegments = existingTranscript.segments.filter((s) => {
		const segMid = (s.start + s.end) / 2;
		return !replaceRanges.some(
			(r) => segMid >= r.start && segMid < r.end,
		);
	});

	// Merge and sort by start time
	const mergedWords = [...keptWords, ...newWords].sort(
		(a, b) => a.start - b.start,
	);
	const mergedSegments = [...keptSegments, ...newSegments].sort(
		(a, b) => a.start - b.start,
	);

	const text = mergedWords.map((w) => w.word).join(" ");
	const duration = Math.max(
		existingTranscript.duration,
		mergedWords.length > 0 ? mergedWords[mergedWords.length - 1].end : 0,
	);

	return {
		text,
		duration,
		words: mergedWords,
		segments: mergedSegments,
		createdAt: new Date().toISOString(),
	};
}
