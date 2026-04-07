/**
 * POST /api/export-video/concat-face
 *
 * Concatenates uploaded face video segments into a single MP4 file
 * and returns its server-side path so it can be passed to /api/render-animation
 * as a PIP overlay rendered natively by Remotion.
 */

import { type NextRequest, NextResponse } from "next/server";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

interface Segment {
	serverPath: string;
	trimStart: number;
	duration: number;
	timelineStart: number;
}

/**
 * Probe the audio stream start_time of a media file using ffprobe.
 * Returns the audio start_time in seconds (0 if no audio or on error).
 */
function probeAudioStartTime(filePath: string): Promise<number> {
	return new Promise((resolve) => {
		const args = [
			"-v", "error",
			"-select_streams", "a:0",
			"-show_entries", "stream=start_time",
			"-of", "csv=p=0",
			filePath,
		];
		const proc = spawn("ffprobe", args);
		let stdout = "";
		proc.stdout.on("data", (d) => { stdout += d.toString(); });
		proc.on("close", () => {
			const val = parseFloat(stdout.trim());
			resolve(Number.isFinite(val) && val > 0 ? val : 0);
		});
		proc.on("error", () => resolve(0));
	});
}

async function concatSegments(segments: Segment[], outputPath: string): Promise<void> {
	const sorted = [...segments]
		.filter((s) => s.duration >= 0.01)
		.sort((a, b) => a.timelineStart - b.timelineStart);

	if (sorted.length === 0) {
		throw new Error("No valid segments to concatenate");
	}

	// Probe each unique file for audio start_time offset.
	const audioOffsetCache = new Map<string, number>();
	for (const seg of sorted) {
		if (!audioOffsetCache.has(seg.serverPath)) {
			const offset = await probeAudioStartTime(seg.serverPath);
			audioOffsetCache.set(seg.serverPath, offset);
			if (offset > 0) {
				console.log(`[concatSegments] Audio offset: ${offset}s for ${seg.serverPath}`);
			}
		}
	}

	const args: string[] = ["-y"];

	for (const seg of sorted) {
		const audioOffset = audioOffsetCache.get(seg.serverPath) ?? 0;
		const containerTrimStart = seg.trimStart + audioOffset;
		args.push("-ss", String(containerTrimStart), "-t", String(seg.duration), "-i", seg.serverPath);
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

	return new Promise((resolve, reject) => {
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
