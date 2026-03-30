/**
 * Lightweight LLM + transcription provider for in-browser AI features.
 *
 * The user supplies their own API keys (stored in localStorage).
 * Supports: OpenAI-compatible, Google Gemini (for LLM), and Groq (for fast transcription).
 */

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";

const STORAGE_KEY = "opencut:ai-provider";

export type AIProviderType = "openai" | "gemini";

/**
 * Per-feature model overrides.
 * Each key maps to the string model ID to use for that pipeline step.
 * When set, takes precedence over the global `model` field.
 */
export interface AIModelOverrides {
	/** Detect scene boundaries from transcript (simple JSON — Flash is fine) */
	boundaryDetect?: string;
	/** Generate per-scene animation direction (creative JSON — Flash is fine) */
	sceneDirection?: string;
	/** Generate initial Remotion component code (complex — Pro recommended) */
	codeGen?: string;
	/** Agentic layout review pass after code gen (rule-based — Flash is fine) */
	codeReview?: string;
	/** Agentic tweak pass for targeted edits (surgical — Pro recommended) */
	tweak?: string;
	/** Vision review — inspects rendered screenshots for layout bugs (must support vision/images) */
	visionReview?: string;
}

export interface AIProviderConfig {
	provider: AIProviderType;
	apiKey: string;
	/** Only used for OpenAI-compatible providers (custom base URL). */
	baseUrl?: string;
	/** Global model fallback — used when no per-feature override is set. */
	model?: string;
	/** Per-feature model overrides — take precedence over the global model. */
	modelOverrides?: AIModelOverrides;
	/** Skip the agentic layout review pass after code generation (faster, less thorough). */
	skipLayoutReview?: boolean;
	/** Groq API key for fast cloud transcription (whisper-large-v3). */
	groqApiKey?: string;
	/** Language hint for transcription (e.g. "hi" for Hindi). */
	transcriptionLanguage?: string;
}

export function getAIProviderConfig(): AIProviderConfig | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		return JSON.parse(raw) as AIProviderConfig;
	} catch {
		return null;
	}
}

export function setAIProviderConfig(config: AIProviderConfig): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearAIProviderConfig(): void {
	localStorage.removeItem(STORAGE_KEY);
}

/**
 * Send a text prompt to the configured LLM and return the response text.
 */
export async function promptLLM({ prompt }: { prompt: string }): Promise<string> {
	const config = getAIProviderConfig();
	if (!config?.apiKey) {
		throw new Error("No AI provider configured. Please set your API key in Settings.");
	}

	let model;
	if (config.provider === "gemini") {
		const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
		model = google(config.model || "gemini-2.0-flash");
	} else {
		const openai = createOpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseUrl || undefined,
		});
		model = openai(config.model || "gpt-4o-mini");
	}

	const { text } = await generateText({ model, prompt, temperature: 0.1 });
	if (!text) throw new Error("Empty response from LLM");
	return text;
}

/**
 * Transcribe an audio blob using Groq's whisper-large-v3.
 * Falls back to null if Groq is not configured.
 */
export async function transcribeWithGroq({
	audioBlob,
	language,
}: {
	audioBlob: Blob;
	language?: string;
}): Promise<{ text: string } | null> {
	const config = getAIProviderConfig();
	if (!config?.groqApiKey) return null;

	const lang = language || config.transcriptionLanguage;

	const formData = new FormData();
	formData.append("file", audioBlob, "audio.mp3");
	formData.append("model", "whisper-large-v3");
	formData.append("response_format", "json");
	if (lang) {
		formData.append("language", lang);
	}

	const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.groqApiKey}`,
		},
		body: formData,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Groq transcription error (${response.status}): ${errorText}`);
	}

	const data = await response.json();
	return { text: data.text?.trim() ?? "" };
}

export interface GroqVerboseWord {
	word: string;
	start: number;
	end: number;
}

export interface GroqVerboseSegment {
	text: string;
	start: number;
	end: number;
}

export interface GroqVerboseResult {
	text: string;
	words: GroqVerboseWord[];
	segments: GroqVerboseSegment[];
}

/**
 * Transcribe an audio blob using Groq with verbose_json format
 * to get word-level and segment-level timestamps.
 */
export async function transcribeWithGroqVerbose({
	audioBlob,
	language,
	prompt,
}: {
	audioBlob: Blob;
	language?: string;
	prompt?: string;
}): Promise<GroqVerboseResult | null> {
	const config = getAIProviderConfig();
	if (!config?.groqApiKey) return null;

	const lang = language || config.transcriptionLanguage;

	const formData = new FormData();
	formData.append("file", audioBlob, "audio.wav");
	formData.append("model", "whisper-large-v3");
	formData.append("response_format", "verbose_json");
	formData.append("timestamp_granularities[]", "word");
	formData.append("timestamp_granularities[]", "segment");
	if (lang) {
		formData.append("language", lang);
	}
	if (prompt) {
		formData.append("prompt", prompt);
	}

	const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.groqApiKey}`,
		},
		body: formData,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Groq transcription error (${response.status}): ${errorText}`);
	}

	const data = await response.json();
	return {
		text: data.text?.trim() ?? "",
		words: data.words ?? [],
		segments: data.segments ?? [],
	};
}

