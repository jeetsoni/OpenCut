/**
 * Per-scene Remotion code generator.
 *
 * Takes a single PlannedScene (with full animation direction) and
 * generates a Remotion component for just that scene.
 */

import { generateText, stepCountIs } from "ai";
import { buildModel } from "@/lib/ai/provider";
import { applyEdit, createCodeEditorTools } from "@/lib/ai/tools/code-editor";
import type { PlannedScene } from "@/lib/scene-planner/schema";
import { captureSceneFrames } from "./capture-frames";
import { visionReviewFrames } from "./vision-review";

export interface SceneCodeGenProgress {
	phase: "preparing" | "generating" | "done";
	message: string;
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

## Defensive Layout Rules (prevent accidental overflow — NOT intentional animations)
These rules apply to STATIC layout only. Animated elements (using interpolate/spring on position/size) are exempt — intentional scale, position, and size transitions are encouraged.

- ALWAYS add overflow:'hidden' to every card/container that has a fixed width or height and is NOT itself animating its size
- For sibling elements that are BOTH statically positioned (no interpolate/spring on top/left/width/height), use flexbox (display:'flex', gap:N) instead of position:'absolute' — static siblings must not share the same screen region
- When using position:'absolute' with hardcoded values (no animation), verify: top + height <= CANVAS_H and left + width <= 992
- ALWAYS add boxSizing:'border-box' to any element with both padding and a fixed size
- Text on a single line inside a fixed-width container: add whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'
- Text on multiple lines in a fixed box: add overflow:'hidden', display:'-webkit-box', WebkitLineClamp:N, WebkitBoxOrient:'vertical'
- Cards that render a mapped array must have a maxHeight and overflow:'hidden' — dynamic lists can grow unbounded otherwise

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

const SCENE_CODE_REVIEW_SYSTEM_PROMPT = `You are a layout QA engineer for Remotion animation components. You fix accidental layout bugs — you do NOT touch intentional animations.

You have two tools:
1. read_code — Read the current code. ALWAYS call this first.
2. edit_code — Replace an exact substring. Make surgical fixes only.

## CRITICAL DISTINCTION — what to fix vs what to leave alone

### DO NOT touch (intentional animation):
- Any element whose position (top/left) or size (width/height) is computed with interpolate(), spring(), or Math.sin() — these animate deliberately and overlap is intentional
- Elements inside different <Sequence> blocks — they don't coexist at the same frame
- Scale transforms (transform: \`scale(\${v})\`) — intentional grow/shrink
- Opacity transitions — intentional reveal

### DO fix (accidental bugs — static layout only):
These are issues on elements with HARDCODED pixel values and no animation on their position/size.

**Static overlap**: Two siblings both using position:'absolute' with hardcoded top/left/width/height where their bounding boxes intersect AND neither element uses interpolate/spring on its position or size. Fix by converting to flexbox or adjusting static positions.

**Flex overflow**: Flex column children whose heights + gaps sum to more than the parent's fixed height, where none of those heights is animated. Fix by reducing a height or adding overflow:'hidden' to the parent.

**Text overflow**: Text inside a fixed-width container with no overflow protection:
- Single-line label → add whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'
- Multi-line text in fixed box → add overflow:'hidden', display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical'

**Out-of-bounds static element**: Element with hardcoded top + height > 1080 or left + width > 992. Fix by reducing the value.

**Unbounded mapped list**: A .map() rendering children inside a fixed-height container without overflow:'hidden' or maxHeight — the list can grow past the container. Add overflow:'hidden'.

## Workflow
1. Call read_code
2. For each issue found, write a one-line note: "Bug: [type] — [element description]"
3. Call edit_code for each fix — smallest possible change
4. If no bugs found, respond: "No layout issues found."

Rules:
- oldStr must match exactly (whitespace-sensitive)
- Do NOT redesign — only patch the specific bug
- If unsure whether an overlap is intentional, leave it alone`;

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

	const model = buildModel({ gemini: "gemini-2.5-pro-preview-06-05" });
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
		tools: createCodeEditorTools(
			() => currentCode,
			(c) => { currentCode = c; },
		),
	});

	// Validate the final code still has Main
	if (!currentCode.includes("Main")) {
		throw new Error("Tweaked code is missing the Main component — edits may have broken the structure.");
	}

	onProgress?.({ phase: "done", message: `Tweak applied for "${scene.name}"` });

	return currentCode;
}

/**
 * Agentic layout review pass — reads the generated code and applies surgical
 * fixes for overlap, text overflow, and out-of-bounds issues.
 */
async function reviewSceneCode(
	code: string,
	sceneName: string,
): Promise<string> {
	const model = buildModel({ gemini: "gemini-2.5-pro-preview-06-05" });
	let currentCode = code;

	await generateText({
		model,
		system: SCENE_CODE_REVIEW_SYSTEM_PROMPT,
		prompt: `Review the animation code for scene "${sceneName}" and fix any layout issues you find. Start by calling read_code.`,
		temperature: 0.1,
		stopWhen: stepCountIs(8),
		tools: createCodeEditorTools(
			() => currentCode,
			(c) => { currentCode = c; },
		),
	});

	// If the review broke the component, return the original
	if (!currentCode.includes("Main")) return code;
	return currentCode;
}

const SCENE_CODE_VISION_FIX_SYSTEM_PROMPT = `You are a precise code editor for Remotion animation components. The user will provide specific visual bugs found by inspecting actual screenshots of the animation. Fix ONLY those bugs.

You have two tools:
1. read_code — Returns the current animation code. ALWAYS call this first.
2. edit_code — Replaces an exact substring in the code with a new substring.

## Rules
- Make the SMALLEST possible fix for each reported bug
- oldStr must be an EXACT substring of the current code (whitespace-sensitive)
- DO NOT redesign or restyle anything not in the bug list
- DO NOT touch animated elements (interpolate/spring on position/size) — these are intentional
- After all fixes, respond briefly with what you changed`;

/**
 * One agentic fix pass driven by vision feedback.
 * Only runs when the vision model found actual bugs.
 */
async function fixWithVisionFeedback(
	code: string,
	issues: string,
	sceneName: string,
): Promise<string> {
	const model = buildModel({ gemini: "gemini-2.5-pro-preview-06-05" });
	let currentCode = code;

	await generateText({
		model,
		system: SCENE_CODE_VISION_FIX_SYSTEM_PROMPT,
		prompt: `Fix these visual bugs found in scene "${sceneName}" by reviewing actual screenshots:\n\n${issues}\n\nStart by calling read_code, then make surgical edits for each bug.`,
		temperature: 0.1,
		stopWhen: stepCountIs(8),
		tools: createCodeEditorTools(
			() => currentCode,
			(c) => { currentCode = c; },
		),
	});

	if (!currentCode.includes("Main")) return code;
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

	const model = buildModel({ gemini: "gemini-2.5-pro-preview-06-05" });
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

	let code = extractCode(text);
	if (!code.includes("Main")) throw new Error("Generated code missing Main component.");

	onProgress?.({ phase: "generating", message: `Reviewing layout for "${scene.name}"...` });
	code = await reviewSceneCode(code, scene.name);

	// Option C: vision-based review — capture actual rendered frames and feed to the model
	try {
		onProgress?.({ phase: "generating", message: `Visual review for "${scene.name}"...` });
		const frames = await captureSceneFrames(code, scene);
		if (frames.length > 0) {
			const issues = await visionReviewFrames(frames, scene.name);
			const hasIssues = !issues.toLowerCase().includes("no visual issues");
			if (hasIssues) {
				console.log(`[VisionReview] Scene "${scene.name}" issues found:\n${issues}`);
				onProgress?.({ phase: "generating", message: `Fixing visual issues for "${scene.name}"...` });
				code = await fixWithVisionFeedback(code, issues, scene.name);
			}
		}
	} catch (err) {
		// Vision review is best-effort — never fail the overall pipeline
		console.warn(`[VisionReview] Skipped for "${scene.name}":`, err);
	}

	onProgress?.({ phase: "done", message: `Code ready for "${scene.name}"` });

	return code;
}
