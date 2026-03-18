/**
 * Persistent transcription cache backed by IndexedDB.
 *
 * Keyed by a hash of (mediaId + trimStart + trimEnd) so the same audio
 * region is never transcribed twice — even across sessions.
 *
 * The cached segments can be reused for captions, retake detection, etc.
 */

import { IndexedDBAdapter } from "@/services/storage/indexeddb-adapter";
import type { TranscriptionSegment } from "@/types/transcription";

export interface CachedTranscription {
	/** Composite key: mediaId:startTime:endTime */
	id: string;
	text: string;
	segments: TranscriptionSegment[];
	language: string;
	createdAt: number;
}

const adapter = new IndexedDBAdapter<CachedTranscription>(
	"opencut-transcription-cache",
	"transcriptions",
);

export function buildCacheKey({
	mediaId,
	startTime,
	endTime,
}: {
	mediaId: string;
	startTime: number;
	endTime: number;
}): string {
	// Round to 2 decimal places to avoid floating point key mismatches
	const s = startTime.toFixed(2);
	const e = endTime.toFixed(2);
	return `${mediaId}:${s}:${e}`;
}

export async function getCachedTranscription({
	key,
}: {
	key: string;
}): Promise<CachedTranscription | null> {
	return adapter.get(key);
}

export async function setCachedTranscription({
	key,
	text,
	segments,
	language,
}: {
	key: string;
	text: string;
	segments: TranscriptionSegment[];
	language: string;
}): Promise<void> {
	await adapter.set(key, {
		id: key,
		text,
		segments,
		language,
		createdAt: Date.now(),
	});
}

export async function getAllCachedTranscriptions(): Promise<CachedTranscription[]> {
	return adapter.getAll();
}

export async function clearTranscriptionCache(): Promise<void> {
	return adapter.clear();
}
