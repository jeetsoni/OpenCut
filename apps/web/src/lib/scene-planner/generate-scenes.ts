/**
 * Scene planner service — generates a structured scenes JSON from a
 * word-level transcript using Vercel AI SDK.
 *
 * Runs client-side, calling the user's configured AI provider directly
 * via the AI SDK (no server route needed — keys are in localStorage).
 */

import { generateText } from "ai";
import { buildModel } from "@/lib/ai/provider";
import { scenePlanSchema, type ScenePlan } from "./schema";
import {
	SCENE_PLANNER_SYSTEM_PROMPT,
	SCENE_PLANNER_DESIGN_SYSTEM,
	SCENE_PLANNER_ANIMATION_RULES,
} from "./prompt";
import type { ProjectTranscript } from "@/types/transcription";

export interface ScenePlannerProgress {
	phase: "preparing" | "generating" | "validating" | "done";
	message: string;
}

/**
 * Format the transcript into a compact string for the prompt.
 */
function formatTranscriptForPrompt(transcript: ProjectTranscript): string {
	const wordList = transcript.words
		.map((w) => `${w.word} [${w.start.toFixed(2)}-${w.end.toFixed(2)}]`)
		.join(" ");

	return `## Transcript

Full text: "${transcript.text}"

Duration: ${transcript.duration.toFixed(2)}s

Word-level timestamps:
${wordList}`;
}

/**
 * Extract JSON from a text response that may contain markdown fences.
 */
function extractJson(text: string): string {
	// Try to extract from ```json ... ``` blocks
	const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (fenceMatch) return fenceMatch[1].trim();
	// Otherwise try to find the outermost { ... }
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start !== -1 && end > start) return text.slice(start, end + 1);
	return text;
}

/**
 * Generate a scene plan from a project transcript.
 *
 * Uses Vercel AI SDK's generateText to get a JSON response, then
 * parses and validates with Zod. This avoids the deep type
 * instantiation errors that Output.object() causes with complex schemas.
 */
export async function generateScenePlan({
	transcript,
	onProgress,
}: {
	transcript: ProjectTranscript;
	onProgress?: (progress: ScenePlannerProgress) => void;
}): Promise<ScenePlan> {
	onProgress?.({
		phase: "preparing",
		message: "Preparing transcript for scene planner...",
	});

	const model = buildModel({ gemini: "gemini-2.5-flash" });
	const transcriptPrompt = formatTranscriptForPrompt(transcript);

	const systemPrompt = [
		SCENE_PLANNER_SYSTEM_PROMPT,
		SCENE_PLANNER_DESIGN_SYSTEM,
		SCENE_PLANNER_ANIMATION_RULES,
	].join("\n\n");

	const userPrompt = `${transcriptPrompt}

Generate a complete scene plan for this transcript. Follow the design system and animation rules exactly.
- Split into 3-10 scenes based on natural topic shifts
- Each scene must have 2-4 beats with rich animation directions
- Every word must be assigned to exactly one scene
- Use the correct accent colors based on word meaning
- totalFrames = Math.round(totalDuration * 30)
- fps is always 30

IMPORTANT: Respond with ONLY valid JSON matching this structure (no markdown, no explanation):
{
  "title": "string",
  "totalDuration": number,
  "fps": 30,
  "totalFrames": number,
  "designSystem": {
    "background": "#hex", "surface": "#hex", "raised": "#hex",
    "textPrimary": "#hex", "textMuted": "#hex",
    "accents": { "hookFear": "#hex", "wrongPath": "#hex", "techCode": "#hex", "revelation": "#hex", "cta": "#hex", "violet": "#hex" }
  },
  "scenes": [{
    "id": number, "name": "string", "type": "Hook|Analogy|Bridge|Architecture|Spotlight|Comparison|Power|CTA",
    "description": "string", "startTime": number, "endTime": number,
    "startFrame": number, "endFrame": number, "durationFrames": number,
    "text": "string",
    "words": [{ "word": "string", "start": number, "end": number }],
    "animationDirection": {
      "colorAccent": "#hex", "mood": "string", "layout": "string",
      "beats": [{ "id": "string", "timeRange": [start, end], "frameRange": [start, end],
        "spokenText": "string", "visual": "string", "typography": "string",
        "motion": "string", "sfx": ["string"] }]
    }
  }]
}`;

	onProgress?.({ phase: "generating", message: "AI is planning scenes..." });

	const { text } = await generateText({
		model,
		system: systemPrompt,
		prompt: userPrompt,
		temperature: 0.4,
	});

	if (!text) {
		throw new Error(
			"Scene planner returned empty output. Try again or switch AI provider.",
		);
	}

	onProgress?.({ phase: "validating", message: "Validating scene plan..." });

	// Parse the JSON response
	const jsonStr = extractJson(text);
	let raw: unknown;
	try {
		raw = JSON.parse(jsonStr);
	} catch {
		throw new Error(
			"Scene planner returned invalid JSON. Try again or switch AI provider.",
		);
	}

	// Validate with Zod
	const parsed = scenePlanSchema.safeParse(raw);
	if (!parsed.success) {
		console.warn("Scene plan Zod validation issues:", parsed.error.issues);
		// Still usable if the structure is roughly correct
	}

	const plan = (parsed.success ? parsed.data : raw) as ScenePlan;

	// Sanity check
	let totalSceneWords = 0;
	for (const scene of plan.scenes) {
		totalSceneWords += scene.words.length;
	}
	if (totalSceneWords === 0) {
		throw new Error("Scene plan has no words assigned to scenes.");
	}

	onProgress?.({
		phase: "done",
		message: `Generated ${plan.scenes.length} scenes`,
	});

	return plan;
}
