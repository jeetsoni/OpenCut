/**
 * POST /api/render-animation
 *
 * Renders animation scenes into a standalone MP4 using @remotion/renderer.
 * Frame-accurate, deterministic rendering — no jitter or timing issues.
 *
 * Request body:
 * {
 *   scenes: AnimationSceneData[]  (startTime/endTime in seconds)
 *   fps: number
 *   duration: number              (total duration in seconds)
 *   width: number
 *   height: number
 *   quality: "low" | "medium" | "high" | "very_high"
 * }
 *
 * Response: SSE progress events followed by binary MP4 data.
 */

import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

export const maxDuration = 600; // 10 min for long animations

/** CRF values for libx264 (lower = better quality) */
const QUALITY_CRF: Record<string, number> = {
	low: 28,
	medium: 23,
	high: 18,
	very_high: 12,
};

/** x264 preset per quality level */
const QUALITY_PRESET: Record<string, string> = {
	low: "fast",
	medium: "medium",
	high: "slow",
	very_high: "slow",
};

function sendSSE(
	controller: ReadableStreamDefaultController,
	event: { type: string; [key: string]: unknown },
) {
	controller.enqueue(
		new TextEncoder().encode(`data:${JSON.stringify(event)}\n`),
	);
}

export async function POST(request: NextRequest) {
	const tmpDir = path.join(os.tmpdir(), `opencut-anim-${Date.now()}`);
	fs.mkdirSync(tmpDir, { recursive: true });

	try {
		const body = await request.json();
		const {
			scenes = [],
			fps = 30,
			duration,
			width = 1080,
			height = 1920,
			quality = "high",
		} = body;

		if (!scenes.length || !duration) {
			return NextResponse.json(
				{ error: "Missing scenes or duration" },
				{ status: 400 },
			);
		}

		// Convert seconds → frames for the Remotion composition
		const totalFrames = Math.max(1, Math.round(duration * fps));
		const scenesWithFrames = scenes.map(
			(s: { startTime: number; endTime: number; [k: string]: unknown }) => ({
				...s,
				startFrame: Math.round(s.startTime * fps),
				durationFrames: Math.max(1, Math.round((s.endTime - s.startTime) * fps)),
			}),
		);

		const outputPath = path.join(tmpDir, "animation.mp4");

		const stream = new ReadableStream({
			async start(controller) {
				try {
					sendSSE(controller, {
						type: "progress",
						progress: 0.02,
						stage: "Bundling composition...",
					});

					const [{ renderMedia, selectComposition }, { bundle }] =
						await Promise.all([
							import("@remotion/renderer"),
							import("@remotion/bundler"),
						]);

					const entryPoint = path.resolve(
						process.cwd(),
						"src/lib/remotion-renderer/server-composition.tsx",
					);

					const bundleLocation = await bundle({
						entryPoint,
						webpackOverride: (config) => ({
							...config,
							resolve: {
								...config.resolve,
								alias: {
									...(config.resolve?.alias ?? {}),
									"@": path.resolve(process.cwd(), "src"),
								},
							},
						}),
					});

					sendSSE(controller, {
						type: "progress",
						progress: 0.1,
						stage: "Setting up composition...",
					});

					const inputProps = { scenes: scenesWithFrames };

					const composition = await selectComposition({
						serveUrl: bundleLocation,
						id: "animation",
						inputProps,
					});

					const compositionWithOverrides = {
						...composition,
						fps,
						durationInFrames: totalFrames,
						width,
						height,
					};

					const chromiumPath = process.env.CHROMIUM_PATH || undefined;
					const crf = QUALITY_CRF[quality] ?? 18;
					const x264Preset = QUALITY_PRESET[quality] ?? "medium";

					sendSSE(controller, {
						type: "progress",
						progress: 0.12,
						stage: "Rendering frames...",
					});

					await renderMedia({
						composition: compositionWithOverrides,
						serveUrl: bundleLocation,
						codec: "h264",
						outputLocation: outputPath,
						inputProps,
						crf,
						x264Preset: x264Preset as Parameters<typeof renderMedia>[0]["x264Preset"],
						...(chromiumPath ? { browserExecutable: chromiumPath } : {}),
						onProgress: ({ progress }) => {
							const adjusted = 0.12 + progress * 0.78;
							sendSSE(controller, {
								type: "progress",
								progress: adjusted,
								stage: "Rendering frames...",
							});
						},
					});

					sendSSE(controller, {
						type: "progress",
						progress: 0.92,
						stage: "Finalizing...",
					});

					const fileBuffer = fs.readFileSync(outputPath);
					sendSSE(controller, { type: "complete" });

					const enc = new TextEncoder();
					controller.enqueue(enc.encode("\n---BINARY_START---\n"));

					const CHUNK_SIZE = 64 * 1024;
					for (let i = 0; i < fileBuffer.length; i += CHUNK_SIZE) {
						const chunkSize = Math.min(CHUNK_SIZE, fileBuffer.length - i);
						controller.enqueue(
							new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset + i, chunkSize),
						);
					}

					controller.close();
				} catch (err) {
					console.error("[render-animation] Render error:", err);
					sendSSE(controller, {
						type: "error",
						error: err instanceof Error ? err.message : "Render failed",
					});
					controller.close();
				} finally {
					try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
				}
			},
		});

		return new NextResponse(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	} catch (error) {
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
		console.error("[render-animation] Failed:", error);
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Unknown error" },
			{ status: 500 },
		);
	}
}
