/**
 * Shared AI model factory for all agents in the codebase.
 *
 * Single source of truth for building a Vercel AI SDK model instance from
 * the user's stored provider config. Import `buildModel` in every agent
 * instead of repeating the provider-switching logic.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
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

	const openai = createOpenAI({
		apiKey: config.apiKey,
		baseURL: config.baseUrl || undefined,
	});
	return openai(featureOverride || config.model || defaults?.openai || "gpt-4o-mini");
}
