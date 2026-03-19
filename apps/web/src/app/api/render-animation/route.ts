/**
 * POST /api/render-animation
 *
 * Receives scene animation data (code + directions + timing) and
 * renders an MP4 using @remotion/renderer on the server.
 *
 * Request body:
 * {
 *   scenes: [{ code, direction, startFrame, durationFrames, sceneId }],
 *   fps: number,
 *   totalFrames: number,
 *   width: number,
 *   height: number,
 * }
 *
 * Returns: MP4 binary stream
 */

import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

export const maxDuration = 300; // 5 min timeout for long renders

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const { scenes, fps = 30, totalFrames, width = 1080, height = 1920 } = body;

		if (!scenes?.length || !totalFrames) {
			return NextResponse.json(
				{ error: "Missing scenes or totalFrames" },
				{ status: 400 },
			);
		}

		// Dynamic import to keep @remotion/renderer out of the client bundle
		const { renderMedia, selectComposition } = await import("@remotion/renderer");
		const { bundle } = await import("@remotion/bundler");

		// Bundle the Remotion composition entry point.
		// In production, this should be pre-bundled at build time for speed.
		// For now, we bundle on-demand (cached by Remotion internally).
		const entryPoint = path.resolve(
			process.cwd(),
			"src/lib/remotion-renderer/server-composition.tsx",
		);

		const bundleLocation = await bundle({
			entryPoint,
			// Remotion bundler uses its own webpack — add @/ alias so imports resolve
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

		const inputProps = { scenes };

		const composition = await selectComposition({
			serveUrl: bundleLocation,
			id: "animation",
			inputProps,
		});

		// Override composition settings with the request values
		const compositionWithOverrides = {
			...composition,
			fps,
			durationInFrames: totalFrames,
			width,
			height,
		};

		// Render to a temp file
		const tmpDir = os.tmpdir();
		const outputPath = path.join(
			tmpDir,
			`opencut-animation-${Date.now()}.mp4`,
		);

		// Detect Chromium/Chrome executable
		const chromiumPath = process.env.CHROMIUM_PATH
			|| (process.platform === "win32"
				? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
				: undefined);

		await renderMedia({
			composition: compositionWithOverrides,
			serveUrl: bundleLocation,
			codec: "h264",
			outputLocation: outputPath,
			inputProps,
			chromiumOptions: {
				...(chromiumPath ? { executablePath: chromiumPath } : {}),
			},
		});

		// Stream the file back
		const fileBuffer = fs.readFileSync(outputPath);

		// Clean up temp file
		try {
			fs.unlinkSync(outputPath);
		} catch {
			// ignore cleanup errors
		}

		return new NextResponse(fileBuffer, {
			status: 200,
			headers: {
				"Content-Type": "video/mp4",
				"Content-Disposition": "attachment; filename=animation.mp4",
				"Content-Length": String(fileBuffer.length),
			},
		});
	} catch (error) {
		console.error("[render-animation] Failed:", error);
		const message =
			error instanceof Error ? error.message : "Unknown render error";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
