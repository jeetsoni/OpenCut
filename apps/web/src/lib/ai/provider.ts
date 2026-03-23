/**
 * Shared AI model factory for all agents in the codebase.
 *
 * Single source of truth for building a Vercel AI SDK model instance from
 * the user's stored provider config. Import `buildModel` in every agent
 * instead of repeating the provider-switching logic.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { getAIProviderConfig } from "@/lib/ai-provider";

/**
 * Build a Vercel AI SDK model from the user's stored provider config.
 * Throws if no API key is configured.
 *
 * @param defaults - Per-provider model fallbacks. Use when an agent needs a
 *   specific capability tier (e.g. flash vs pro vs vision).
 *   Falls back to the user's configured model, then to these defaults.
 */
export function buildModel(defaults?: { gemini?: string; openai?: string }) {
	const config = getAIProviderConfig();
	if (!config?.apiKey) {
		throw new Error("No AI provider configured. Add your API key in AI Settings.");
	}

	if (config.provider === "gemini") {
		const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
		return google(config.model || defaults?.gemini || "gemini-2.0-flash");
	}

	const openai = createOpenAI({
		apiKey: config.apiKey,
		baseURL: config.baseUrl || undefined,
	});
	return openai(config.model || defaults?.openai || "gpt-4o-mini");
}
