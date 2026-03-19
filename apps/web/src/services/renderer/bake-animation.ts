/**
 * Client-side service to "bake" animations into an MP4 via the server.
 *
 * Gathers scene code + directions from IndexedDB, sends them to
 * POST /api/render-animation, and returns the MP4 as a Blob.
 *
 * The caller can then add this blob as a media asset on the timeline,
 * making the final export a simple video composite with no html2canvas.
 */

import { getProjectBoundaries } from "@/lib/scene-planner/boundaries-store";
import { getSceneRemotionCode } from "@/lib/remotion-renderer/scene-code-store";
import { getSceneDirection } from "@/lib/scene-planner/scene-direction-store";
import type { PlannedScene } from "@/lib/scene-planner/schema";

interface BakeScene {
	sceneId: number;
	code: string;
	direction: PlannedScene;
	startFrame: number;
	durationFrames: number;
}

interface BakeOptions {
	projectId: string;
	fps?: number;
	width?: number;
	height?: number;
	onProgress?: (status: string) => void;
}

interface BakeResult {
	success: true;
	blob: Blob;
	url: string;
	duration: number;
}

interface BakeError {
	success: false;
	error: string;
}

/**
 * Gather all scene animation data and send to the server for rendering.
 */
export async function bakeAnimation(
	options: BakeOptions,
): Promise<BakeResult | BakeError> {
	const { projectId, fps = 30, width = 1080, height = 1920, onProgress } = options;

	try {
		onProgress?.("Gathering scene data...");

		const boundaries = await getProjectBoundaries({ projectId });
		if (!boundaries) {
			return { success: false, error: "No scene boundaries found" };
		}

		// Collect all scenes that have both direction and animation code
		const scenes: BakeScene[] = [];
		for (const b of boundaries.boundaries) {
			const [direction, codeResult] = await Promise.all([
				getSceneDirection({ projectId, sceneId: b.id }),
				getSceneRemotionCode({ projectId, sceneId: b.id }),
			]);

			if (!direction || !codeResult) continue;

			scenes.push({
				sceneId: b.id,
				code: codeResult.code,
				direction,
				startFrame: Math.round(b.startTime * fps),
				durationFrames: Math.round((b.endTime - b.startTime) * fps),
			});
		}

		if (scenes.length === 0) {
			return { success: false, error: "No scenes with animations found" };
		}

		const totalFrames = Math.round(boundaries.totalDuration * fps);

		onProgress?.("Rendering animation on server...");

		const response = await fetch("/api/render-animation", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				scenes,
				fps,
				totalFrames,
				width,
				height,
			}),
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => null);
			const message = errorData?.error || `Server error: ${response.status}`;
			return { success: false, error: message };
		}

		onProgress?.("Processing result...");

		const blob = new Blob([await response.arrayBuffer()], {
			type: "video/mp4",
		});
		const url = URL.createObjectURL(blob);
		const duration = boundaries.totalDuration;

		return { success: true, blob, url, duration };
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Unknown error during bake";
		return { success: false, error: message };
	}
}
