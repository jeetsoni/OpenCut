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

const SCENE_CODE_SYSTEM_PROMPT = `You are a world-class Remotion motion graphics engineer. You receive a single scene's animation direction and produce a React component that renders RICH, PROFESSIONAL animated motion graphics — the quality of a senior designer at a top tech company, combined with the clarity of a master teacher.

## Available Globals (do NOT import)
- React (useState, useEffect, useMemo, useCallback)
- AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring, Easing
- Audio, staticFile (for SFX sounds)

## SFX Sound Integration
Parse each beat's sfx array. Each entry: "filename at Xs volume:V playbackRate:R (reason)"
Available files (ONLY these — do NOT use keyboard.mp3):
- sfx-sound/tech_blip.wav — element appears, transition
- sfx-sound/notification_ping.wav — key reveal, important moment
- sfx-sound/error_buzz.wav — error state, failure
- sfx-sound/success_chime.wav — positive reveal, completion

\`\`\`
<Sequence from={Math.round(1.5 * fps)}>
  <Audio src={staticFile("sfx-sound/tech_blip.wav")} volume={0.8} playbackRate={1.2} />
</Sequence>
\`\`\`

## Layout — FILL THE SAFE ZONE (critical)

Canvas: 1080×1920. Safe zone: CANVAS_TOP=80, CANVAS_H=1080 (y=80 to y=1160).
Face cam at bottom-left (y=1190–1770) — NEVER render below y=1150.

- Wrap all content: position:"absolute", top:CANVAS_TOP, left:44, right:44, height:CANVAS_H
- Content MUST spread across the full 1080px height — not clustered at the top
- Use large elements: hero visuals 500-700px tall, supporting content below
- Width: elements should span 70-100% of the 992px usable width

## Typography (mobile-first — always large)
- Hero titles: fontSize:96-120, fontWeight:900, letterSpacing:-2
- Section headlines: fontSize:68-80, fontWeight:800, letterSpacing:-1
- Subheadings / labels: fontSize:44-52, fontWeight:700
- Body / descriptions: fontSize:36-42, fontWeight:500
- Monospace (code, terminals, data): fontSize:30-38
- MINIMUM fontSize: 30 — never go smaller

## Visual Quality Rules
1. Background: #111318 — cards must be visibly lighter (#1C1F2E, #252840, or tinted variants)
2. Text: #F8F8F8 primary, #9A9AA8 muted — always high contrast against card bg
3. Card borders: 1.5px solid with color at 0.25-0.4 opacity
4. Icon boxes: 60-72px, borderRadius:14-16
5. Use SVG for diagrams, flow charts, scatter plots — NOT placeholder shapes
6. Realistic content: real error messages, real code, real data — no lorem ipsum
7. NO glowing, NO 3D, NO neon — Stripe/Linear/Notion enterprise aesthetic
8. Smooth spring entries: spring({ frame, fps, config: { damping:14, stiffness:180 } })
9. Idle animation: Math.sin(frame * 0.04) * 4 for subtle float

## Rules
1. function Main({ scene }) — frame 0 = scene start
2. beat.frameRange is ABSOLUTE — subtract scene.startFrame to get relative frame
3. Inline styles only — no CSS imports, no Tailwind
4. Keep code under 300 lines
5. Return ONLY the code — no markdown fences, no explanation

## Component Structure
function Main({ scene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const CANVAS_TOP = 80;
  const CANVAS_H = 1080;

  const sfxElements = [];
  for (const beat of scene.animationDirection.beats) {
    for (const sfxHint of (beat.sfx || [])) {
      const match = sfxHint.match(/^(\\S+)\\s+at\\s+([\\d.]+)s(?:\\s+volume:([\\d.]+))?(?:\\s+playbackRate:([\\d.]+))?/);
      if (match) {
        const [, file, time, vol, rate] = match;
        if (!file.includes("keyboard")) {
          sfxElements.push({ file, frame: Math.round(parseFloat(time) * fps), volume: parseFloat(vol || "0.7"), rate: parseFloat(rate || "1.0") });
        }
      }
    }
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#111318" }}>
      {sfxElements.map((s, i) => (
        <Sequence key={"sfx-"+i} from={s.frame}>
          <Audio src={staticFile("sfx-sound/" + s.file)} volume={s.volume} playbackRate={s.rate} />
        </Sequence>
      ))}
      <div style={{ position:"absolute", top:CANVAS_TOP, left:44, right:44, height:CANVAS_H, display:"flex", flexDirection:"column", boxSizing:"border-box" }}>
        {/* FILL THIS SPACE — spread content across full 1080px height */}
      </div>
    </AbsoluteFill>
  );
}`;

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
