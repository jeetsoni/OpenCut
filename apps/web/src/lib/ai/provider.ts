/**
 * Shared AI model factory for all agents in the codebase.
 *
 * Single source of truth for building a Vercel AI SDK model instance from
 * the user's stored provider config. Import `buildModel` in every agent
 * instead of repeating the provider-switching logic.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getAIProviderConfig, type AIModelOverrides } from "@/lib/ai-provider";

/**
 * Build a Vercel AI SDK model from the user's stored provider config.
 * Throws if no API key is configured.
 *
 * Model resolution order (highest priority first):
 *   1. config.modelOverrides[feature]  — user's per-feature override
 *   2. config.model                    — user's global model
 *   3. defaults.gemini / defaults.openai — hardcoded per-call fallback
 *   4. "gemini-2.0-flash" / "gpt-4o-mini" — final fallback
 *
 * @param defaults - Per-provider model fallbacks and optional feature key.
 */
export function buildModel(defaults?: {
	gemini?: string;
	openai?: string;
	feature?: keyof AIModelOverrides;
}) {
	const config = getAIProviderConfig();
	if (!config?.apiKey) {
		throw new Error("No AI provider configured. Add your API key in AI Settings.");
	}

	const featureOverride =
		defaults?.feature ? config.modelOverrides?.[defaults.feature] : undefined;

	if (config.provider === "gemini") {
		const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
		return google(featureOverride || config.model || defaults?.gemini || "gemini-2.0-flash");
	}

	if (config.provider === "openrouter") {
		const openrouter = createOpenRouter({ apiKey: config.apiKey });
		return openrouter.chat(featureOverride || config.model || defaults?.openai || "anthropic/claude-3.5-sonnet");
	}

	const openai = createOpenAI({
		apiKey: config.apiKey,
		baseURL: config.baseUrl || undefined,
	});
	return openai(featureOverride || config.model || defaults?.openai || "gpt-4o-mini");
}

/**
 * Returns the Google Search tool for grounding, or undefined if the user
 * is on an OpenAI provider (which doesn't support this tool).
 *
 * Usage: pass the returned object into the `tools` field of generateText().
 * The model decides autonomously when to search — no extra prompting needed.
 */
export function getGoogleSearchTool(): Record<string, unknown> | undefined {
	const config = getAIProviderConfig();
	if (config?.provider !== "gemini" || !config.apiKey) return undefined;

	const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
	return { google_search: google.tools.googleSearch({}) };
}
