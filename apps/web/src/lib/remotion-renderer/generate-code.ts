/**
 * AI-powered Remotion code generator.
 *
 * Takes a ScenePlan and asks the LLM to produce a React component
 * string that uses Remotion primitives to render motion graphics.
 */

import { buildModel } from "@/lib/ai/provider";
import { tracedGenerateText } from "@/lib/ai/tracing";
import type { ScenePlan } from "@/lib/scene-planner/schema";
import {
	buildRemotionCodeSystemPrompt,
	REMOTION_CODE_USER_PROMPT_PREFIX,
} from "./prompt";
import { getAnimationTheme } from "@/lib/animation-theme";

export interface CodeGenProgress {
	phase: "preparing" | "generating" | "done";
	message: string;
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

	const model = buildModel({ gemini: "gemini-2.5-pro-preview-06-05" });

	// Compact the scene plan to reduce token usage
	const compactPlan = JSON.stringify(scenePlan, null, 1);

	const userPrompt = `${REMOTION_CODE_USER_PROMPT_PREFIX}${compactPlan}`;

	onProgress?.({
		phase: "generating",
		message: "AI is writing Remotion code...",
	});

	const { text } = await tracedGenerateText({
		model,
		system: buildRemotionCodeSystemPrompt(getAnimationTheme()),
		prompt: userPrompt,
		temperature: 0.3,
		langfuse: { name: "generate-remotion-code" },
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
