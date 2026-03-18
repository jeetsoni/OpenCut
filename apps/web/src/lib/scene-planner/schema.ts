/**
 * Zod schema for the scene planner output.
 *
 * Defines the structure of the scenes JSON that the AI generates
 * from a word-level transcript. Based on the transcript-to-scenes
 * workflow spec from the remotion workspace.
 */

import { z } from "zod";

export const sceneWordSchema = z.object({
	word: z.string(),
	start: z.number(),
	end: z.number(),
});

export const sceneBeatSchema = z.object({
	id: z.string().describe("Descriptive beat ID like 'beat1_hook_statement'"),
	timeRange: z.tuple([z.number(), z.number()]).describe("[startSec, endSec]"),
	frameRange: z.tuple([z.number(), z.number()]).describe("[startFrame, endFrame] at 30fps"),
	spokenText: z.string().describe("Exact words spoken during this beat"),
	visual: z.string().describe("Rich visual description — what appears, how it looks, where it sits, what it represents"),
	typography: z.string().describe("Which spoken words get which accent colors in subtitles"),
	motion: z.string().describe("Spring configs, interpolation details, entry/exit animations"),
	sfx: z.array(z.string()).describe("SFX entries: 'filename.wav at timestamp (reason)'"),
});

export const sceneAnimationDirectionSchema = z.object({
	colorAccent: z.string().describe("Primary accent hex color for this scene"),
	mood: z.string().describe("Emotional mood descriptor like 'confident_then_shattered'"),
	layout: z.string().describe("Spatial layout description and how face cam relates to content"),
	beats: z.array(sceneBeatSchema).describe("2-4 beats covering the scene's full duration"),
});

export const plannedSceneSchema = z.object({
	id: z.number(),
	name: z.string().describe("Short descriptive name for the scene"),
	type: z.enum([
		"Hook", "Analogy", "Bridge", "Architecture",
		"Spotlight", "Comparison", "Power", "CTA",
	]).describe("Scene type from the standard set"),
	description: z.string().describe("One sentence describing the scene's purpose"),
	startTime: z.number(),
	endTime: z.number(),
	startFrame: z.number().describe("Math.round(startTime * 30)"),
	endFrame: z.number().describe("Math.round(endTime * 30)"),
	durationFrames: z.number().describe("endFrame - startFrame"),
	text: z.string().describe("Full spoken text for this scene"),
	words: z.array(sceneWordSchema),
	animationDirection: sceneAnimationDirectionSchema,
});

export const designSystemSchema = z.object({
	background: z.string(),
	surface: z.string(),
	raised: z.string(),
	textPrimary: z.string(),
	textMuted: z.string(),
	accents: z.object({
		hookFear: z.string(),
		wrongPath: z.string(),
		techCode: z.string(),
		revelation: z.string(),
		cta: z.string(),
		violet: z.string(),
	}),
});

export const scenePlanSchema = z.object({
	title: z.string().describe("Video title derived from transcript content"),
	totalDuration: z.number().describe("Total duration in seconds"),
	fps: z.literal(30),
	totalFrames: z.number().describe("Math.round(totalDuration * 30)"),
	designSystem: designSystemSchema,
	scenes: z.array(plannedSceneSchema).min(3).max(10),
});

export type ScenePlan = z.infer<typeof scenePlanSchema>;
export type PlannedScene = z.infer<typeof plannedSceneSchema>;
export type SceneBeat = z.infer<typeof sceneBeatSchema>;
export type SceneAnimationDirection = z.infer<typeof sceneAnimationDirectionSchema>;
