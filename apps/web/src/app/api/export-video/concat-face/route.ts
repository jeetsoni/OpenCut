/**
 * POST /api/export-video/concat-face
 *
 * Concatenates uploaded face video segments into a single MP4 file
 * and returns its server-side path so it can be passed to /api/render-animation
 * as a PIP overlay rendered natively by Remotion.
 */

import { type NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";

interface Segment {
	serverPath: string;
	trimStart: number;
	duration: number;
	timelineStart: number;
}

function concatSegments(segments: Segment[], outputPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const sorted = [...segments]
			.filter((s) => s.duration >= 0.01)
			.sort((a, b) => a.timelineStart - b.timelineStart);

		if (sorted.length === 0) {
			reject(new Error("No valid segments to concatenate"));
			return;
		}

		const args: string[] = ["-y"];

		for (const seg of sorted) {
			args.push("-ss", String(seg.trimStart), "-t", String(seg.duration), "-i", seg.serverPath);
		}

		if (sorted.length === 1) {
			args.push(
				"-c:v", "libx264", "-preset", "fast", "-crf", "18",
				"-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
				outputPath,
			);
		} else {
			const filterParts: string[] = [];
			for (let i = 0; i < sorted.length; i++) {
				filterParts.push(`[${i}:v]setpts=PTS-STARTPTS[v${i}]`);
				filterParts.push(`[${i}:a]asetpts=PTS-STARTPTS[a${i}]`);
			}
			const concatInputs = sorted.map((_, i) => `[v${i}][a${i}]`).join("");
			filterParts.push(`${concatInputs}concat=n=${sorted.length}:v=1:a=1[outv][outa]`);

			args.push(
				"-filter_complex", filterParts.join(";"),
				"-map", "[outv]", "-map", "[outa]",
				"-c:v", "libx264", "-preset", "fast", "-crf", "18",
				"-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
				outputPath,
			);
		}

		const ff = spawn("ffmpeg", args);
		let stderr = "";
		ff.stderr.on("data", (d) => { stderr += d.toString(); });
		ff.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg concat exited ${code}: ${stderr.slice(-400)}`));
		});
		ff.on("error", reject);
	});
}

export async function POST(request: NextRequest) {
	try {
		const { segments } = await request.json() as { segments: Segment[] };

		if (!segments?.length) {
			return NextResponse.json({ error: "No segments provided" }, { status: 400 });
		}

		const filename = `opencut-face-${Date.now()}.mp4`;
		const outputPath = path.join(os.tmpdir(), filename);
		await concatSegments(segments, outputPath);

		return NextResponse.json({ faceVideoPath: outputPath, faceVideoFilename: filename });
	} catch (err) {
		console.error("[concat-face]", err);
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "Concat failed" },
			{ status: 500 },
		);
	}
}
