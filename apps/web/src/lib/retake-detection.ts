/**
 * AI-powered retake detection.
 *
 * Given a set of audible audio segments (from silence detection), this module:
 * 1. Transcribes each segment (Groq cloud if configured, else in-browser Whisper)
 * 2. Caches every transcription in IndexedDB for reuse (captions, re-runs, etc.)
 * 3. Sends all transcriptions to an LLM to identify retakes/mistakes
 * 4. Returns which segment indices to keep
 */

import { transcriptionService } from "@/services/transcription/service";
import {
	getCachedTranscription,
	setCachedTranscription,
	buildCacheKey,
} from "@/services/transcription/cache";
import { decodeAudioToFloat32 } from "@/lib/media/audio";
import { transcribeWithGroq, promptLLM, getAIProviderConfig } from "@/lib/ai-provider";
import type { AudioSegment } from "@/lib/silence-detection";

export interface TranscribedSegment {
	index: number;
	startTime: number;
	endTime: number;
	text: string;
}

export interface RetakeDetectionProgress {
	phase: "transcribing" | "analyzing";
	current: number;
	total: number;
	message: string;
}

/**
 * Transcribe segments and cache results. Does NOT call the LLM.
 * Use `analyzeRetakes` separately for the single LLM call.
 */
export async function transcribeSegments({
	audioBlob,
	segments,
	mediaId,
	onProgress,
}: {
	audioBlob: Blob;
	segments: AudioSegment[];
	mediaId: string;
	onProgress?: (progress: RetakeDetectionProgress) => void;
}): Promise<TranscribedSegment[]> {
	if (segments.length === 0) return [];

	const config = getAIProviderConfig();
	const useGroq = Boolean(config?.groqApiKey);

	const { samples, sampleRate } = await decodeAudioToFloat32({ audioBlob });

	const transcribed: TranscribedSegment[] = [];

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		onProgress?.({
			phase: "transcribing",
			current: i + 1,
			total: segments.length,
			message: `Transcribing segment ${i + 1}/${segments.length}...`,
		});

		const cacheKey = buildCacheKey({
			mediaId,
			startTime: seg.startTime,
			endTime: seg.endTime,
		});
		const cached = await getCachedTranscription({ key: cacheKey });
		if (cached) {
			transcribed.push({
				index: i,
				startTime: seg.startTime,
				endTime: seg.endTime,
				text: cached.text,
			});
			continue;
		}

		let text = "";

		if (useGroq) {
			const start = performance.now();
			text = await transcribeSegmentWithGroq({ samples, sampleRate, segment: seg });
			const elapsed = performance.now() - start;
			if (elapsed < 3200 && i < segments.length - 1) {
				await new Promise((r) => setTimeout(r, 3200 - elapsed));
			}
		} else {
			text = await transcribeSegmentInBrowser({ samples, sampleRate, segment: seg });
		}

		await setCachedTranscription({
			key: cacheKey,
			text,
			segments: [{ text, start: seg.startTime, end: seg.endTime }],
			language: config?.transcriptionLanguage || "auto",
		});

		transcribed.push({ index: i, startTime: seg.startTime, endTime: seg.endTime, text });
	}

	return transcribed;
}

/**
 * Full pipeline: transcribe + single LLM call. Convenience wrapper
 * when processing a single source media.
 */
export async function detectRetakes({
	audioBlob,
	segments,
	mediaId,
	onProgress,
}: {
	audioBlob: Blob;
	segments: AudioSegment[];
	mediaId: string;
	onProgress?: (progress: RetakeDetectionProgress) => void;
}): Promise<number[]> {
	if (segments.length === 0) return [];
	if (segments.length === 1) return [0];

	const transcribed = await transcribeSegments({ audioBlob, segments, mediaId, onProgress });

	onProgress?.({
		phase: "analyzing",
		current: 0,
		total: 1,
		message: "Analyzing transcriptions with AI...",
	});

	return analyzeRetakes({ transcribed });
}

/**
 * Ask the LLM which segments are retakes. Returns indices to KEEP.
 * Exported so the command can batch multiple elements into one call.
 */
export async function analyzeRetakes({
	transcribed,
}: {
	transcribed: TranscribedSegment[];
}): Promise<number[]> {
	if (transcribed.length <= 1) return transcribed.map((t) => t.index);

	const clipList = transcribed
		.map(
			(c) =>
				`ID: ${c.index} | Start: ${c.startTime.toFixed(1)}s | Text: "${c.text}"`,
		)
		.join("\n");

	const prompt = `You are an expert AI video editor.

I will provide you with a list of sequential video clips that contain a speaker's transcribed text.
The speaker frequently stuttered, made mistakes, stopped, and repeated lines (retakes).
Your job is to read all the clips sequentially, logically identify which clips are bad takes, warmups, or mistakes, and determine which clips represent the final, continuous, perfectly flowing presentation.

CRITICAL RULES:
1. Delete any aborted takes or obvious mistakes.
2. If the same sentence or idea is spoken multiple times, ALWAYS keep the LAST occurrence and DELETE all earlier attempts. The speaker always does retakes in chronological order, so the last version is the final intended take.
3. Very short clips (1-2 words) at the beginning are usually false starts - remove them.
4. Your final output must ONLY be a JSON array of the clip IDs that we should KEEP.
5. DO NOT OUTPUT ANY EXPLANATION OR MARKDOWN FORMATTING (do not use \`\`\`json). JUST THE RAW JSON ARRAY.

Here are the clips:

${clipList}`;

	const rawResponse = await promptLLM({ prompt });

	const cleaned = rawResponse
		.replace(/```json/g, "")
		.replace(/```/g, "")
		.trim();

	try {
		const parsed = JSON.parse(cleaned);
		if (!Array.isArray(parsed)) {
			throw new Error("LLM response was not an array");
		}
		return parsed.filter(
			(id): id is number =>
				typeof id === "number" && id >= 0 && id < transcribed.length,
		);
	} catch {
		console.warn("Failed to parse LLM retake analysis, keeping all segments");
		return transcribed.map((t) => t.index);
	}
}

async function transcribeSegmentWithGroq({
	samples,
	sampleRate,
	segment,
}: {
	samples: Float32Array;
	sampleRate: number;
	segment: AudioSegment;
}): Promise<string> {
	const startSample = Math.floor(segment.startTime * sampleRate);
	const endSample = Math.min(
		Math.floor(segment.endTime * sampleRate),
		samples.length,
	);
	const segmentSamples = samples.slice(startSample, endSample);

	if (segmentSamples.length === 0) return "";

	const wavBlob = encodeWav({ samples: segmentSamples, sampleRate });

	try {
		const result = await transcribeWithGroq({ audioBlob: wavBlob });
		return result?.text ?? "";
	} catch (error) {
		console.warn("Groq transcription failed for segment:", error);
		return "";
	}
}

async function transcribeSegmentInBrowser({
	samples,
	sampleRate,
	segment,
}: {
	samples: Float32Array;
	sampleRate: number;
	segment: AudioSegment;
}): Promise<string> {
	const startSample = Math.floor(segment.startTime * sampleRate);
	const endSample = Math.min(
		Math.floor(segment.endTime * sampleRate),
		samples.length,
	);
	const segmentSamples = samples.slice(startSample, endSample);

	if (segmentSamples.length === 0) return "";

	try {
		const result = await transcriptionService.transcribe({
			audioData: segmentSamples,
		});
		return result.text.trim();
	} catch {
		return "";
	}
}

function encodeWav({
	samples,
	sampleRate,
}: {
	samples: Float32Array;
	sampleRate: number;
}): Blob {
	const numChannels = 1;
	const bitsPerSample = 16;
	const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
	const blockAlign = numChannels * (bitsPerSample / 8);
	const dataSize = samples.length * (bitsPerSample / 8);
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	writeString(view, 0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeString(view, 8, "WAVE");

	writeString(view, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);

	writeString(view, 36, "data");
	view.setUint32(40, dataSize, true);

	let offset = 44;
	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(
			offset,
			clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
			true,
		);
		offset += 2;
	}

	return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string): void {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}
