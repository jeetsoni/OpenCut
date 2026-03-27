/**
 * Lightweight AI scene boundary detection.
 *
 * Only detects WHERE scenes start/end and gives them names + types.
 * No design direction, no animation beats — that comes later per-scene.
 */

import { buildModel } from "@/lib/ai/provider";
import { tracedGenerateText } from "@/lib/ai/tracing";
import { sceneBoundariesSchema, type SceneBoundaries } from "./boundaries";
import type { ProjectTranscript } from "@/types/transcription";

export interface BoundaryDetectionProgress {
	phase: "preparing" | "detecting" | "validating" | "done";
	message: string;
}

function formatTranscript(transcript: ProjectTranscript): string {
	const wordList = transcript.words
		.map((w) => `${w.word} [${w.start.toFixed(2)}-${w.end.toFixed(2)}]`)
		.join(" ");

	return `Full text: "${transcript.text}"\nDuration: ${transcript.duration.toFixed(2)}s\n\nWord timestamps:\n${wordList}`;
}

function extractJson(text: string): string {
	const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (fenceMatch) return fenceMatch[1].trim();
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start !== -1 && end > start) return text.slice(start, end + 1);
	return text;
}

const BOUNDARY_SYSTEM_PROMPT = `You are a video scene boundary detector. Given a word-level transcript, split it into logical scenes.

Rules:
- Each scene covers ONE coherent idea or topic shift
- 2-15 scenes depending on video length
- Each scene should be 2-12 seconds
- Scene types: Hook, Analogy, Bridge, Architecture, Spotlight, Comparison, Power, CTA
- Every word must belong to exactly one scene (no gaps, no overlaps)
- startTime/endTime come from the word timestamps

Respond with ONLY valid JSON:
{
  "title": "string",
  "totalDuration": number,
  "fps": 30,
  "boundaries": [
    { "id": 1, "name": "short name", "type": "Hook|Analogy|...", "startTime": 0.0, "endTime": 3.5, "text": "spoken words in this scene" }
  ]
}`;

export async function detectSceneBoundaries({
	transcript,
	onProgress,
}: {
	transcript: ProjectTranscript;
	onProgress?: (progress: BoundaryDetectionProgress) => void;
}): Promise<SceneBoundaries> {
	onProgress?.({ phase: "preparing", message: "Preparing transcript..." });

	const model = buildModel({ gemini: "gemini-2.5-flash", feature: "boundaryDetect" });
	const transcriptText = formatTranscript(transcript);

	onProgress?.({ phase: "detecting", message: "AI is detecting scene boundaries..." });

	const { text } = await tracedGenerateText({
		model,
		system: BOUNDARY_SYSTEM_PROMPT,
		prompt: transcriptText,
		temperature: 0.3,
		langfuse: { name: "detect-boundaries" },
	});

	if (!text) {
		throw new Error("Boundary detection returned empty output. Try again.");
	}

	onProgress?.({ phase: "validating", message: "Validating boundaries..." });

	const jsonStr = extractJson(text);
	let raw: unknown;
	try {
		raw = JSON.parse(jsonStr);
	} catch {
		throw new Error("Boundary detection returned invalid JSON. Try again.");
	}

	const parsed = sceneBoundariesSchema.safeParse(raw);
	if (!parsed.success) {
		console.warn("Boundary validation issues:", parsed.error.issues);
	}

	const result = (parsed.success ? parsed.data : raw) as SceneBoundaries;

	if (!result.boundaries || result.boundaries.length === 0) {
		throw new Error("No scene boundaries detected.");
	}

	onProgress?.({ phase: "done", message: `Detected ${result.boundaries.length} scenes` });

	return result;
}
