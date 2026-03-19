/**
 * Per-scene design direction generator.
 *
 * Takes a single scene boundary + transcript words and generates
 * the full design direction (animation beats, colors, motion specs)
 * for just that scene.
 */

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { getAIProviderConfig } from "@/lib/ai-provider";
import type { SceneBoundary } from "./boundaries";
import type { PlannedScene } from "./schema";
import {
	SCENE_PLANNER_DESIGN_SYSTEM,
	SCENE_PLANNER_ANIMATION_RULES,
} from "./prompt";
import type { ProjectTranscript } from "@/types/transcription";

export interface DirectionProgress {
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

function extractJson(text: string): string {
	const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (fenceMatch) return fenceMatch[1].trim();
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start !== -1 && end > start) return text.slice(start, end + 1);
	return text;
}

const DIRECTION_SYSTEM_PROMPT = `You are a creative director for short-form video. You receive a single scene boundary (with its spoken text and timestamps) and produce detailed animation directions for that scene only.

${SCENE_PLANNER_DESIGN_SYSTEM}

${SCENE_PLANNER_ANIMATION_RULES}

Respond with ONLY valid JSON for this single scene:
{
  "id": number,
  "name": "string",
  "type": "Hook|Analogy|Bridge|Architecture|Spotlight|Comparison|Power|CTA",
  "description": "one sentence purpose",
  "startTime": number,
  "endTime": number,
  "startFrame": number,
  "endFrame": number,
  "durationFrames": number,
  "text": "spoken text",
  "words": [{ "word": "string", "start": number, "end": number }],
  "animationDirection": {
    "colorAccent": "#hex",
    "mood": "string",
    "layout": "string",
    "beats": [{
      "id": "string",
      "timeRange": [start, end],
      "frameRange": [start, end],
      "spokenText": "string",
      "visual": "detailed description",
      "typography": "accent color assignments",
      "motion": "spring/interpolation specs",
      "sfx": ["filename.wav at time (reason)"]
    }]
  }
}`;

/**
 * Generate design direction for a single scene.
 */
export async function generateSceneDirection({
	boundary,
	transcript,
	onProgress,
}: {
	boundary: SceneBoundary;
	transcript: ProjectTranscript;
	onProgress?: (progress: DirectionProgress) => void;
}): Promise<PlannedScene> {
	onProgress?.({ phase: "preparing", message: `Preparing scene "${boundary.name}"...` });

	const model = buildModel();

	// Extract words that fall within this scene's time range
	const sceneWords = transcript.words.filter(
		(w) => w.start >= boundary.startTime - 0.1 && w.end <= boundary.endTime + 0.1,
	);

	const wordList = sceneWords
		.map((w) => `${w.word} [${w.start.toFixed(2)}-${w.end.toFixed(2)}]`)
		.join(" ");

	const userPrompt = `Generate detailed animation direction for this scene:

Scene: ${boundary.name} (${boundary.type})
Time: ${boundary.startTime.toFixed(2)}s – ${boundary.endTime.toFixed(2)}s
Duration: ${(boundary.endTime - boundary.startTime).toFixed(2)}s
Spoken text: "${boundary.text}"

Word timestamps:
${wordList}

Remember:
- startFrame = Math.round(startTime * 30), endFrame = Math.round(endTime * 30)
- durationFrames = endFrame - startFrame
- 2-4 beats covering the full scene duration
- Use correct accent colors based on word meaning`;

	onProgress?.({ phase: "generating", message: `AI is directing scene "${boundary.name}"...` });

	const { text } = await generateText({
		model,
		system: DIRECTION_SYSTEM_PROMPT,
		prompt: userPrompt,
		temperature: 0.4,
	});

	if (!text) {
		throw new Error("Direction generation returned empty output.");
	}

	const jsonStr = extractJson(text);
	const raw = JSON.parse(jsonStr) as PlannedScene;

	// Ensure IDs and times match the boundary
	raw.id = boundary.id;
	raw.startTime = boundary.startTime;
	raw.endTime = boundary.endTime;
	raw.startFrame = Math.round(boundary.startTime * 30);
	raw.endFrame = Math.round(boundary.endTime * 30);
	raw.durationFrames = raw.endFrame - raw.startFrame;

	onProgress?.({ phase: "done", message: `Direction ready for "${boundary.name}"` });

	return raw;
}
