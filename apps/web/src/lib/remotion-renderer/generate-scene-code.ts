/**
 * Per-scene Remotion code generator.
 *
 * Takes a single PlannedScene (with full animation direction) and
 * generates a Remotion component for just that scene.
 */

import { generateText, tool, stepCountIs } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { getAIProviderConfig } from "@/lib/ai-provider";
import { z } from "zod";
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
		return google(config.model || "gemini-3.1-pro-preview");
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

## CRITICAL LAYOUT CONSTRAINT: Face Cam Safe Zone

The canvas is 1080×1920. A face cam video box is ALWAYS composited at the bottom-left:
- Face cam: left=40, bottom=150, width=440, height=580 (occupies y≈1190 to y≈1770)

ALL content MUST stay in the SAFE ZONE above the face cam:
- Define: const CANVAS_TOP = 80; const CANVAS_H = 1080;
- Wrap all content: position:"absolute", top:CANVAS_TOP, left:44, right:44, height:CANVAS_H
- NEVER render below y≈1150 — it will be hidden behind the face cam

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
  const CANVAS_TOP = 80;
  const CANVAS_H = 1080;
  // scene.animationDirection.beats has the timing
  // beat.frameRange is ABSOLUTE — subtract scene.startFrame to get relative
  return (
    <AbsoluteFill style={{ backgroundColor: "#0D0E14" }}>
      <div style={{ position: "absolute", top: CANVAS_TOP, left: 44, right: 44, height: CANVAS_H, display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
        {/* All content goes here — safely above the face cam */}
      </div>
    </AbsoluteFill>
  );
}

Return ONLY the code. No markdown, no explanation.`;

const SCENE_CODE_TWEAK_SYSTEM_PROMPT = `You are a precise code editor for Remotion animation components. You have two tools:

1. read_code — Returns the current animation code. ALWAYS call this first.
2. edit_code — Replaces an exact substring in the code with a new substring.

## Workflow
1. Call read_code to see the current code
2. Identify the minimal change needed for the user's request
3. Call edit_code with the exact oldStr to find and the newStr to replace it with
4. If edit_code fails (oldStr not found), read the error, call read_code again, and retry with the corrected oldStr

## Rules
- Make the SMALLEST possible edit. For a color change, just replace the hex value.
- oldStr must be an EXACT substring of the current code (whitespace-sensitive)
- You can call edit_code multiple times for multi-part changes
- Do NOT rewrite the entire function — only patch what's needed
- After all edits, respond with a brief summary of what you changed`;

/**
 * Apply a string replacement to code, with error feedback.
 */
function applyEdit(code: string, oldStr: string, newStr: string): { ok: true; code: string } | { ok: false; error: string } {
	if (oldStr === newStr) {
		return { ok: false, error: "oldStr and newStr are identical — nothing to change." };
	}

	const idx = code.indexOf(oldStr);
	if (idx === -1) {
		// Provide helpful context: show a snippet around where it might be
		const lines = code.split("\n");
		const preview = lines.slice(0, Math.min(5, lines.length)).join("\n");
		return {
			ok: false,
			error: `oldStr not found in code. Make sure it matches exactly (whitespace matters). First 5 lines of current code:\n${preview}`,
		};
	}

	// Check for multiple occurrences
	const secondIdx = code.indexOf(oldStr, idx + 1);
	if (secondIdx !== -1) {
		return {
			ok: false,
			error: `oldStr matches multiple locations (at index ${idx} and ${secondIdx}). Include more surrounding context to make it unique.`,
		};
	}

	const updated = code.slice(0, idx) + newStr + code.slice(idx + oldStr.length);
	return { ok: true, code: updated };
}

const MAX_TWEAK_STEPS = 10;

/**
 * Tweak existing Remotion code using an agentic tool-based approach.
 * The AI reads the code, then makes surgical edits via string replacement.
 */
export async function tweakSceneRemotionCode({
	existingCode,
	tweakPrompt,
	scene,
	onProgress,
}: {
	existingCode: string;
	tweakPrompt: string;
	scene: PlannedScene;
	onProgress?: (progress: SceneCodeGenProgress) => void;
}): Promise<string> {
	onProgress?.({ phase: "preparing", message: `Preparing tweak for "${scene.name}"...` });

	const model = buildModel();
	let currentCode = existingCode;

	const userPrompt = `The user wants to tweak the animation for scene "${scene.name}" (${scene.type}, ${scene.startTime.toFixed(1)}s–${scene.endTime.toFixed(1)}s).

User's request: ${tweakPrompt}

Start by calling read_code to see the current animation, then use edit_code to make the minimal changes needed.`;

	onProgress?.({ phase: "generating", message: `Tweaking "${scene.name}"...` });

	await generateText({
		model,
		system: SCENE_CODE_TWEAK_SYSTEM_PROMPT,
		prompt: userPrompt,
		temperature: 0.1,
		stopWhen: stepCountIs(MAX_TWEAK_STEPS),
		tools: {
			read_code: tool({
				description: "Read the current animation code for this scene.",
				inputSchema: z.object({}),
				execute: async () => {
					return { code: currentCode };
				},
			}),
			edit_code: tool({
				description: "Replace an exact substring in the animation code. oldStr must match exactly (whitespace-sensitive). Returns success or an error message to help you retry.",
				inputSchema: z.object({
					oldStr: z.string().describe("The exact substring to find and replace"),
					newStr: z.string().describe("The replacement string"),
				}),
				execute: async ({ oldStr, newStr }: { oldStr: string; newStr: string }) => {
					const result = applyEdit(currentCode, oldStr, newStr);
					if (result.ok) {
						currentCode = result.code;
						return { success: true, message: "Edit applied successfully." };
					}
					return { success: false, message: result.error };
				},
			}),
		},
	});

	// Validate the final code still has Main
	if (!currentCode.includes("Main")) {
		throw new Error("Tweaked code is missing the Main component — edits may have broken the structure.");
	}

	onProgress?.({ phase: "done", message: `Tweak applied for "${scene.name}"` });

	return currentCode;
}

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
