import type { LanguageCode } from "./language";

export type TranscriptionLanguage = LanguageCode | "auto";

export interface TranscriptionSegment {
	text: string;
	start: number;
	end: number;
}

export interface TranscriptionResult {
	text: string;
	segments: TranscriptionSegment[];
	language: string;
}

export type TranscriptionStatus =
	| "idle"
	| "loading-model"
	| "transcribing"
	| "complete"
	| "error";

export interface TranscriptionProgress {
	status: TranscriptionStatus;
	progress: number;
	message?: string;
}

export type TranscriptionModelId =
	| "whisper-tiny"
	| "whisper-small"
	| "whisper-medium"
	| "whisper-large-v3-turbo";

export interface TranscriptionModel {
	id: TranscriptionModelId;
	name: string;
	huggingFaceId: string;
	description: string;
}

export interface CaptionChunk {
	text: string;
	startTime: number;
	duration: number;
}

/** A single word with precise start/end timestamps. */
export interface TranscriptionWord {
	word: string;
	start: number;
	end: number;
}

/** Full project-level transcript with word-level timestamps. */
export interface ProjectTranscript {
	/** The full concatenated text. */
	text: string;
	/** Total duration of the transcribed audio in seconds. */
	duration: number;
	/** Word-level timestamps (the primary data for scene planning). */
	words: TranscriptionWord[];
	/** Sentence/phrase-level segments. */
	segments: TranscriptionSegment[];
	/** ISO timestamp of when this transcript was generated. */
	createdAt: string;
}
