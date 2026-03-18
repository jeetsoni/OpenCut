/**
 * Chunked word-level transcription for the full timeline audio.
 *
 * Whisper hallucinates timestamps on audio longer than ~30s, so we split
 * the audio into small chunks (default 20s), transcribe each via Groq's
 * verbose_json endpoint, then merge all words/segments with offset-adjusted
 * timestamps.
 *
 * Supports both Groq (cloud, fast) and in-browser Whisper (fallback).
 */

import {
	getAIProviderConfig,
	transcribeWithGroqVerbose,
} from "@/lib/ai-provider";
import { transcriptionService } from "@/services/transcription/service";
import { encodeWav } from "@/utils/wav";
import type {
	ProjectTranscript,
	TranscriptionWord,
	TranscriptionSegment,
} from "@/types/transcription";

const DEFAULT_CHUNK_SECONDS = 20;
const GROQ_RATE_LIMIT_MS = 3200;

export interface TranscriptGenerationProgress {
	phase: "extracting" | "transcribing" | "merging";
	current: number;
	total: number;
	message: string;
}

/**
 * Generate a full word-level transcript from decoded audio samples.
 *
 * The caller is responsible for extracting audio from the timeline
 * (decoding video elements, mixing down to mono Float32, etc.).
 */
export async function generateTranscript({
	samples,
	sampleRate,
	onProgress,
}: {
	samples: Float32Array;
	sampleRate: number;
	onProgress?: (progress: TranscriptGenerationProgress) => void;
}): Promise<ProjectTranscript> {
	const durationSeconds = samples.length / sampleRate;
	const config = getAIProviderConfig();
	const useGroq = Boolean(config?.groqApiKey);

	if (useGroq) {
		return transcribeChunkedGroq({ samples, sampleRate, durationSeconds, onProgress });
	}

	return transcribeChunkedBrowser({ samples, sampleRate, durationSeconds, onProgress });
}

/**
 * Chunked transcription via Groq verbose_json with word-level timestamps.
 * Splits audio into ~20s chunks to avoid Whisper hallucinations.
 */
async function transcribeChunkedGroq({
	samples,
	sampleRate,
	durationSeconds,
	onProgress,
}: {
	samples: Float32Array;
	sampleRate: number;
	durationSeconds: number;
	onProgress?: (progress: TranscriptGenerationProgress) => void;
}): Promise<ProjectTranscript> {
	const chunkDuration = DEFAULT_CHUNK_SECONDS;
	const totalChunks = Math.ceil(durationSeconds / chunkDuration);

	const allWords: TranscriptionWord[] = [];
	const allSegments: TranscriptionSegment[] = [];
	let fullText = "";

	for (let i = 0; i < totalChunks; i++) {
		const startSec = i * chunkDuration;
		const endSec = Math.min((i + 1) * chunkDuration, durationSeconds);

		onProgress?.({
			phase: "transcribing",
			current: i + 1,
			total: totalChunks,
			message: `Transcribing chunk ${i + 1}/${totalChunks}...`,
		});

		const startSample = Math.floor(startSec * sampleRate);
		const endSample = Math.min(Math.floor(endSec * sampleRate), samples.length);
		const chunkSamples = samples.slice(startSample, endSample);

		if (chunkSamples.length === 0) continue;

		const wavBlob = encodeWav({ samples: chunkSamples, sampleRate });

		const startTime = performance.now();

		const result = await transcribeWithGroqVerbose({ audioBlob: wavBlob });

		if (result) {
			if (result.text) {
				fullText += (fullText ? " " : "") + result.text.trim();
			}

			for (const w of result.words) {
				allWords.push({
					word: w.word,
					start: w.start + startSec,
					end: w.end + startSec,
				});
			}

			for (const s of result.segments) {
				allSegments.push({
					text: s.text,
					start: s.start + startSec,
					end: s.end + startSec,
				});
			}
		}

		// Rate-limit to avoid Groq 429s
		const elapsed = performance.now() - startTime;
		if (elapsed < GROQ_RATE_LIMIT_MS && i < totalChunks - 1) {
			await sleep(GROQ_RATE_LIMIT_MS - elapsed);
		}
	}

	onProgress?.({
		phase: "merging",
		current: totalChunks,
		total: totalChunks,
		message: "Finalizing transcript...",
	});

	return {
		text: fullText,
		duration: durationSeconds,
		words: allWords,
		segments: allSegments,
		createdAt: new Date().toISOString(),
	};
}

/**
 * Fallback: chunked transcription using in-browser Whisper.
 * Returns segment-level timestamps (word-level not available in-browser).
 */
async function transcribeChunkedBrowser({
	samples,
	sampleRate,
	durationSeconds,
	onProgress,
}: {
	samples: Float32Array;
	sampleRate: number;
	durationSeconds: number;
	onProgress?: (progress: TranscriptGenerationProgress) => void;
}): Promise<ProjectTranscript> {
	const chunkDuration = DEFAULT_CHUNK_SECONDS;
	const totalChunks = Math.ceil(durationSeconds / chunkDuration);

	const allWords: TranscriptionWord[] = [];
	const allSegments: TranscriptionSegment[] = [];
	let fullText = "";

	for (let i = 0; i < totalChunks; i++) {
		const startSec = i * chunkDuration;
		const endSec = Math.min((i + 1) * chunkDuration, durationSeconds);

		onProgress?.({
			phase: "transcribing",
			current: i + 1,
			total: totalChunks,
			message: `Transcribing chunk ${i + 1}/${totalChunks} (in-browser)...`,
		});

		const startSample = Math.floor(startSec * sampleRate);
		const endSample = Math.min(Math.floor(endSec * sampleRate), samples.length);
		const chunkSamples = samples.slice(startSample, endSample);

		if (chunkSamples.length === 0) continue;

		try {
			const result = await transcriptionService.transcribe({
				audioData: chunkSamples,
			});

			if (result.text) {
				fullText += (fullText ? " " : "") + result.text.trim();
			}

			// In-browser Whisper returns chunk-level segments; approximate words
			// by splitting segment text and distributing timestamps evenly.
			for (const seg of result.segments) {
				allSegments.push({
					text: seg.text,
					start: seg.start + startSec,
					end: seg.end + startSec,
				});

				const words = seg.text.trim().split(/\s+/).filter(Boolean);
				if (words.length === 0) continue;

				const segDuration = seg.end - seg.start;
				const wordDuration = segDuration / words.length;

				for (let w = 0; w < words.length; w++) {
					allWords.push({
						word: words[w],
						start: seg.start + startSec + w * wordDuration,
						end: seg.start + startSec + (w + 1) * wordDuration,
					});
				}
			}
		} catch {
			// Skip failed chunks
		}
	}

	onProgress?.({
		phase: "merging",
		current: totalChunks,
		total: totalChunks,
		message: "Finalizing transcript...",
	});

	return {
		text: fullText,
		duration: durationSeconds,
		words: allWords,
		segments: allSegments,
		createdAt: new Date().toISOString(),
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
