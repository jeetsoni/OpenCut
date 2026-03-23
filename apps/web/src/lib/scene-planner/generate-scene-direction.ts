/**
 * Per-scene design direction generator.
 *
 * Takes a single scene boundary + transcript words and generates
 * the full design direction (animation beats, colors, motion specs)
 * for just that scene.
 */

import { generateText } from "ai";
import { buildModel } from "@/lib/ai/provider";
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

function extractJson(text: string): string {
	const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (fenceMatch) return fenceMatch[1].trim();
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start !== -1 && end > start) return text.slice(start, end + 1);
	return text;
}

const DIRECTION_SYSTEM_PROMPT = `You are a world-class motion graphics director with deep AI engineering knowledge and a master teacher's instinct for visual explanation. You receive a single scene boundary and produce detailed animation directions that result in RICH, PROFESSIONAL animations — the kind a senior motion designer at a top-tier tech company would create.

## CRITICAL LAYOUT CONSTRAINTS

Canvas: 1080×1920. Safe zone: top=80 to y=1150 (1080px tall, 992px wide after 44px padding each side).
Face cam occupies bottom-left (y=1190–1770, x=0–480) — NEVER place content below y=1150.

### FILL THE SAFE ZONE — This is mandatory
- Content must spread across the FULL 1080px usable height — not clustered in the top 200px
- Use large, breathing layouts: hero elements 600-800px tall, supporting elements below
- Every beat should describe where elements sit across the vertical space: top third, middle, bottom third
- Empty space = wasted screen = bad teaching — fill it with meaningful visuals

### Text sizes (mobile-first — must be large)
- Hero titles: 88-120px, fontWeight 900
- Section headlines: 64-80px, fontWeight 800
- Subheadings / labels: 44-52px, fontWeight 700
- Body / descriptions: 36-42px, fontWeight 500
- Monospace (code, data, terminals): 30-38px
- MINIMUM font size: 30px — anything smaller is unreadable on mobile

## THE #1 RULE: VISUALIZE THE THING ITSELF

When the speaker talks about a concept, you BUILD THE ACTUAL THING on screen — not a card that describes it.
- Chat conversation → build actual chat UI with message bubbles, timestamps, typing indicator
- API request → build terminal/Postman-style UI with method badge, URL, JSON response
- Error/bug → build actual terminal with red stack trace, file paths, line numbers
- Embeddings/vectors → build SVG scatter plot with grid, axis labels, plotted dots, OR animated number bars
- Code execution → build mini IDE with syntax-highlighted code, line numbers, output panel
- Database → build SQL query with syntax highlighting → table result with rows/columns
- Pipeline/flow → build full flow diagram with nodes, animated arrows, data particles
- WhatsApp/chat → build the actual messaging UI with bubbles, ticks, contact info
- Search → build search bar with query typing, results with scores
- Dashboard → build actual stat cards, mini charts, percentage changes

If your visual description could be a bullet point on a PowerPoint slide, it's NOT visual enough. Every beat must describe a REAL UI or TECHNICAL VISUALIZATION with realistic content (real error messages, real code, real data).

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
	previousDirection,
	onProgress,
}: {
	boundary: SceneBoundary;
	transcript: ProjectTranscript;
	previousDirection?: PlannedScene;
	onProgress?: (progress: DirectionProgress) => void;
}): Promise<PlannedScene> {
	onProgress?.({ phase: "preparing", message: `Preparing scene "${boundary.name}"...` });

	const model = buildModel({ gemini: "gemini-2.5-flash" });

	// Extract words that fall within this scene's time range
	const sceneWords = transcript.words.filter(
		(w) => w.start >= boundary.startTime - 0.1 && w.end <= boundary.endTime + 0.1,
	);

	const wordList = sceneWords
		.map((w) => `${w.word} [${w.start.toFixed(2)}-${w.end.toFixed(2)}]`)
		.join(" ");

	const previousSceneContext = previousDirection
		? `## Previous Scene Context (for narrative continuity)
Scene: "${previousDirection.name}" (${previousDirection.type})
Mood: ${previousDirection.animationDirection.mood}
Color accent: ${previousDirection.animationDirection.colorAccent}
Layout: ${previousDirection.animationDirection.layout}
Last beat visual: "${previousDirection.animationDirection.beats.at(-1)?.visual ?? ""}"

Use this to ensure visual continuity — you may contrast, evolve, or build upon it, but avoid repeating the exact same layout or visual element.

`
		: "";

	const userPrompt = `${previousSceneContext}Generate detailed animation direction for this scene:

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
