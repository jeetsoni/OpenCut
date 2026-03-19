/**
 * Per-scene Remotion code generator.
 *
 * Takes a single PlannedScene (with full animation direction) and
 * generates a Remotion component for just that scene.
 */

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { getAIProviderConfig } from "@/lib/ai-provider";
import type { PlannedScene } from "@/lib/scene-planner/schema";

export interface SceneCodeGenProgress {
	phase: "preparing" | "generating" | "done";
	message: string;
}

function buildModel() {
	const config = getAIProviderConfig();
	if (!config?.apiKey) {
		throw new Error("No AI provider configured. Add your API key in AI Settings.");
	}

	if (config.provider === "gemini") {
		const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
		return google(config.model || "gemini-2.5-flash");
	}

	const openai = createOpenAI({
		apiKey: config.apiKey,
		baseURL: config.baseUrl || undefined,
	});
	return openai(config.model || "gpt-4o-mini");
}

function extractCode(text: string): string {
	const fenceMatch = text.match(/```(?:tsx|jsx|typescript|javascript)?\s*\n?([\s\S]*?)\n?```/);
	if (fenceMatch) return fenceMatch[1].trim();
	const trimmed = text.trim();
	if (trimmed.startsWith("function Main")) return trimmed;
	const funcStart = trimmed.indexOf("function Main");
	if (funcStart !== -1) return trimmed.slice(funcStart);
	return trimmed;
}

const SCENE_CODE_SYSTEM_PROMPT = `You are a Remotion code generator. You receive a SINGLE scene's animation direction and produce a React component that renders animated motion graphics for that scene only.

## Available Globals (do NOT import)
- React (useState, useEffect, useMemo, useCallback)
- AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring, Easing

## Rules
1. Export function Main({ scene }) — receives the single scene object
2. Use useCurrentFrame() — frame 0 is the START of this scene
3. Use Sequence for timing beats within the scene
4. Use ONLY inline styles
5. Keep code under 200 lines
6. Dark background (#0D0E14), card-based layouts, flat vector shapes
7. NO glowing, NO 3D, NO neon — Stripe/Linear aesthetic
8. Smooth spring entries, subtle Math.sin idle animations

## Component Structure
function Main({ scene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // scene.animationDirection.beats has the timing
  // beat.frameRange is ABSOLUTE — subtract scene.startFrame to get relative
  return (
    <AbsoluteFill style={{ backgroundColor: "#0D0E14" }}>
      {/* Render beats */}
    </AbsoluteFill>
  );
}

Return ONLY the code. No markdown, no explanation.`;

/**
 * Generate Remotion code for a single scene.
 */
export async function generateSceneRemotionCode({
	scene,
	onProgress,
}: {
	scene: PlannedScene;
	onProgress?: (progress: SceneCodeGenProgress) => void;
}): Promise<string> {
	onProgress?.({ phase: "preparing", message: `Preparing scene "${scene.name}"...` });

	const model = buildModel();
	const sceneJson = JSON.stringify(scene, null, 1);

	const userPrompt = `Generate a Remotion component for this single scene. The component receives the scene object as a prop called "scene".

IMPORTANT:
- frame 0 = start of this scene (not the whole video)
- beat.frameRange values are ABSOLUTE — subtract scene.startFrame to get scene-relative frames
- Start with: function Main({ scene }) {
- Return ONLY code

Scene JSON:
${sceneJson}`;

	onProgress?.({ phase: "generating", message: `AI is coding scene "${scene.name}"...` });

	const { text } = await generateText({
		model,
		system: SCENE_CODE_SYSTEM_PROMPT,
		prompt: userPrompt,
		temperature: 0.3,
	});

	if (!text) throw new Error("Code generator returned empty output.");

	const code = extractCode(text);
	if (!code.includes("Main")) throw new Error("Generated code missing Main component.");

	onProgress?.({ phase: "done", message: `Code ready for "${scene.name}"` });

	return code;
}
