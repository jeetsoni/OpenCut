/**
 * Lightweight LLM + transcription provider for in-browser AI features.
 *
 * The user supplies their own API keys (stored in localStorage).
 * Supports: OpenAI-compatible, Google Gemini (for LLM), and Groq (for fast transcription).
 */

const STORAGE_KEY = "opencut:ai-provider";

export type AIProviderType = "openai" | "gemini";

export interface AIProviderConfig {
	provider: AIProviderType;
	apiKey: string;
	/** Only used for OpenAI-compatible providers (custom base URL). */
	baseUrl?: string;
	model?: string;
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

	if (config.provider === "gemini") {
		return promptGemini({ prompt, config });
	}

	return promptOpenAICompatible({ prompt, config });
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

async function promptGemini({
	prompt,
	config,
}: {
	prompt: string;
	config: AIProviderConfig;
}): Promise<string> {
	const model = config.model || "gemini-2.0-flash";
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			contents: [{ parts: [{ text: prompt }] }],
			generationConfig: { temperature: 0.1 },
		}),
		signal: AbortSignal.timeout(60_000),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Gemini API error (${response.status}): ${errorText}`);
	}

	const data = await response.json();
	const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
	if (!text) {
		const blockReason = data?.candidates?.[0]?.finishReason;
		const promptFeedback = data?.promptFeedback?.blockReason;
		throw new Error(
			`Empty response from Gemini${blockReason ? ` (finishReason: ${blockReason})` : ""}${promptFeedback ? ` (blocked: ${promptFeedback})` : ""}`,
		);
	}
	return text;
}

async function promptOpenAICompatible({
	prompt,
	config,
}: {
	prompt: string;
	config: AIProviderConfig;
}): Promise<string> {
	const baseUrl = config.baseUrl || "https://api.openai.com/v1";
	const model = config.model || "gpt-4o-mini";

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${config.apiKey}`,
		},
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content: prompt }],
			temperature: 0.1,
		}),
		signal: AbortSignal.timeout(60_000),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
	}

	const data = await response.json();
	const text = data?.choices?.[0]?.message?.content;
	if (!text) throw new Error("Empty response from OpenAI");
	return text;
}
