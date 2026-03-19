/**
 * AI-powered Remotion code generator.
 *
 * Takes a ScenePlan and asks the LLM to produce a React component
 * string that uses Remotion primitives to render motion graphics.
 */

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { getAIProviderConfig } from "@/lib/ai-provider";
import type { ScenePlan } from "@/lib/scene-planner/schema";
import {
	REMOTION_CODE_SYSTEM_PROMPT,
	REMOTION_CODE_USER_PROMPT_PREFIX,
} from "./prompt";

export interface CodeGenProgress {
	phase: "preparing" | "generating" | "done";
	message: string;
}

function buildModel() {
	const config = getAIProviderConfig();
	if (!config?.apiKey) {
		throw new Error(
			"No AI provider configured. Add your API key in AI Settings.",
		);
	}

	if (config.provider === "gemini") {
		const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
		return google(config.model || "gemini-3.1-pro-preview");
	}

	const openai = createOpenAI({
		apiKey: config.apiKey,
		baseURL: config.baseUrl || undefined,
	});
	return openai(config.model || "gpt-4o-mini");
}

/**
 * Extract raw code from a response that may contain markdown fences.
 */
function extractCode(text: string): string {
	// Strip ```tsx or ```jsx or ``` fences
	const fenceMatch = text.match(
		/```(?:tsx|jsx|typescript|javascript)?\s*\n?([\s\S]*?)\n?```/,
	);
	if (fenceMatch) return fenceMatch[1].trim();

	// Strip leading/trailing whitespace
	const trimmed = text.trim();

	// If it starts with "function Main" or "const Main", it's raw code
	if (
		trimmed.startsWith("function Main") ||
		trimmed.startsWith("const Main")
	) {
		return trimmed;
	}

	// Try to find the function declaration
	const funcStart = trimmed.indexOf("function Main");
	if (funcStart !== -1) return trimmed.slice(funcStart);

	return trimmed;
}

/**
 * Generate Remotion component code from a ScenePlan.
 */
export async function generateRemotionCode({
	scenePlan,
	onProgress,
}: {
	scenePlan: ScenePlan;
	onProgress?: (progress: CodeGenProgress) => void;
}): Promise<string> {
	onProgress?.({
		phase: "preparing",
		message: "Preparing scene plan for code generation...",
	});

	const model = buildModel();

	// Compact the scene plan to reduce token usage
	const compactPlan = JSON.stringify(scenePlan, null, 1);

	const userPrompt = `${REMOTION_CODE_USER_PROMPT_PREFIX}${compactPlan}`;

	onProgress?.({
		phase: "generating",
		message: "AI is writing Remotion code...",
	});

	const { text } = await generateText({
		model,
		system: REMOTION_CODE_SYSTEM_PROMPT,
		prompt: userPrompt,
		temperature: 0.3,
	});

	if (!text) {
		throw new Error(
			"Code generator returned empty output. Try again or switch AI provider.",
		);
	}

	const code = extractCode(text);

	if (!code.includes("Main")) {
		throw new Error(
			"Generated code does not contain a Main component. Try again.",
		);
	}

	onProgress?.({ phase: "done", message: "Remotion code generated" });

	return code;
}
