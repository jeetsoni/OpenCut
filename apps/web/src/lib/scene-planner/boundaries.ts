/**
 * Scene boundary types and utilities.
 *
 * Scene boundaries are the lightweight first step — just time ranges
 * and names, no design direction or animation beats yet.
 * Users can manually adjust these before proceeding to per-scene work.
 */

import { z } from "zod";

export const sceneBoundarySchema = z.object({
	id: z.number(),
	name: z.string(),
	type: z.enum([
		"Hook", "Analogy", "Bridge", "Architecture",
		"Spotlight", "Comparison", "Power", "CTA",
	]),
	startTime: z.number(),
	endTime: z.number(),
	text: z.string().describe("Spoken text in this scene"),
});

export const sceneBoundariesSchema = z.object({
	title: z.string(),
	totalDuration: z.number(),
	fps: z.literal(30),
	boundaries: z.array(sceneBoundarySchema).min(2).max(15),
});

export type SceneBoundary = z.infer<typeof sceneBoundarySchema>;
export type SceneBoundaries = z.infer<typeof sceneBoundariesSchema>;
