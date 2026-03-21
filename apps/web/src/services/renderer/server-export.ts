/**
 * Client-side service for server-based video export.
 *
 * Unified export flow:
 * 1. Render base video (canvas layers) client-side using existing SceneExporter
 * 2. Upload base video + audio to server
 * 3. Server renders animation frames via Puppeteer + composites with ffmpeg
 * 4. Stream back the final MP4/WebM
 *
 * When no animations exist, the base video is still sent through ffmpeg
 * for consistent, high-quality encoding.
 */

import { getProjectBoundaries } from "@/lib/scene-planner/boundaries-store";
import { getSceneRemotionCode } from "@/lib/remotion-renderer/scene-code-store";
import { getSceneDirection } from "@/lib/scene-planner/scene-direction-store";
import type { PlannedScene } from "@/lib/scene-planner/schema";
import type { ExportFormat, ExportQuality } from "@/types/export";
import type { MediaAsset } from "@/types/assets";

export interface AnimationSceneData {
	sceneId: number;
	code: string;
	direction: PlannedScene;
	startTime: number;
	endTime: number;
}

export interface VideoClipExportData {
	/** Server-side path to the uploaded video file */
	serverPath: string;
	startTime: number;
	duration: number;
	trimStart: number;
}

export interface MainVideoSegment {
	/** Server-side path to the raw (un-encoded) video file */
	serverPath: string;
	/** Offset into the raw file to start from (element trimStart) */
	trimStart: number;
	/** How many seconds of this clip to use */
	duration: number;
	/** When on the timeline this segment begins (element startTime) */
	timelineStart: number;
}

/**
 * Gather animation scenes from IndexedDB for the given project.
 */
export async function gatherAnimationScenes({
	projectId,
}: {
	projectId: string;
}): Promise<AnimationSceneData[]> {
	const boundaries = await getProjectBoundaries({ projectId });
	if (!boundaries) return [];

	const scenes: AnimationSceneData[] = [];
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
			startTime: b.startTime,
			endTime: b.endTime,
		});
	}
	return scenes;
}

/**
 * Upload a blob (base video or audio) to the server temp storage.
 * Returns the server-side file path.
 */
export async function uploadBlob({
	blob,
	filename,
}: {
	blob: Blob;
	filename: string;
}): Promise<string> {
	const formData = new FormData();
	formData.append("file", blob, filename);

	const response = await fetch("/api/export-video/upload-media", {
		method: "POST",
		body: formData,
	});

	if (!response.ok) {
		throw new Error(`Upload failed: ${response.statusText}`);
	}

	const result = await response.json();
	// The upload route returns { files: { [id]: path }, exportDir }
	// We used "file" as the key
	return result.files.file;
}

interface SSEProgressEvent {
	type: "progress";
	progress: number;
	stage: string;
}

interface SSECompleteEvent {
	type: "complete";
}

interface SSEErrorEvent {
	type: "error";
	error: string;
}

type SSEEvent = SSEProgressEvent | SSECompleteEvent | SSEErrorEvent;

/**
 * Call the server export endpoint with the base video path and animation data.
 * Streams progress and returns the final video buffer.
 */
export async function callServerExport({
	baseVideoPath,
	mainVideoSegments,
	audioPath,
	animationScenes,
	videoClips,
	fps,
	duration,
	width,
	height,
	format,
	quality,
	includeAudio,
	onProgress,
	onCancel,
}: {
	baseVideoPath?: string;
	mainVideoSegments?: MainVideoSegment[];
	audioPath?: string;
	animationScenes: AnimationSceneData[];
	videoClips?: VideoClipExportData[];
	fps: number;
	duration: number;
	width: number;
	height: number;
	format: ExportFormat;
	quality: ExportQuality;
	includeAudio: boolean;
	onProgress?: (progress: number, stage: string) => void;
	onCancel?: () => boolean;
}): Promise<{ success: boolean; buffer?: ArrayBuffer; error?: string; cancelled?: boolean }> {
	const response = await fetch("/api/export-video", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			animationScenes,
			videoClips,
			fps,
			duration,
			width,
			height,
			baseVideoPath,
			mainVideoSegments,
			audioPath,
			format,
			quality,
			includeAudio,
		}),
	});

	if (!response.ok) {
		const err = await response.json().catch(() => ({ error: response.statusText }));
		return { success: false, error: err.error || "Export failed" };
	}

	const reader = response.body?.getReader();
	if (!reader) {
		return { success: false, error: "No response stream" };
	}

	const chunks: Uint8Array[] = [];
	const decoder = new TextDecoder();
	let binaryStarted = false;
	let pendingBytes: Uint8Array[] = []; // raw bytes not yet classified
	let serverError: string | null = null;

	const BOUNDARY = "\n---BINARY_START---\n";
	const boundaryBytes = new TextEncoder().encode(BOUNDARY);

	/**
	 * Search for a byte sequence (needle) inside a Uint8Array (haystack).
	 * Returns the index of the first occurrence, or -1 if not found.
	 */
	function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
		outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
			for (let j = 0; j < needle.length; j++) {
				if (haystack[i + j] !== needle[j]) continue outer;
			}
			return i;
		}
		return -1;
	}

	/** Concatenate an array of Uint8Arrays into one. */
	function concatBytes(arrays: Uint8Array[]): Uint8Array {
		const total = arrays.reduce((s, a) => s + a.length, 0);
		const result = new Uint8Array(total);
		let off = 0;
		for (const a of arrays) {
			result.set(a, off);
			off += a.length;
		}
		return result;
	}

	while (true) {
		if (onCancel?.()) {
			reader.cancel();
			return { success: false, cancelled: true };
		}

		const { done, value } = await reader.read();
		if (done) break;

		if (binaryStarted) {
			// Already past the boundary — everything is binary video data
			chunks.push(value);
			continue;
		}

		// Accumulate raw bytes and search for the boundary
		pendingBytes.push(value);
		const accumulated = concatBytes(pendingBytes);
		const boundaryIdx = findBytes(accumulated, boundaryBytes);

		if (boundaryIdx !== -1) {
			// Found the boundary — everything before it is SSE text
			const sseBytes = accumulated.slice(0, boundaryIdx);
			const sseText = decoder.decode(sseBytes);
			serverError = parseSSELines(sseText, onProgress);

			// Everything after the boundary is binary video data
			const afterBoundary = accumulated.slice(boundaryIdx + boundaryBytes.length);
			if (afterBoundary.length > 0) {
				chunks.push(afterBoundary);
			}

			binaryStarted = true;
			pendingBytes = [];
		} else {
			// No boundary yet — parse any complete SSE lines we can
			// Keep the last chunk in pending in case boundary spans chunks
			const text = decoder.decode(accumulated, { stream: true });
			const lastNewline = text.lastIndexOf("\n");
			if (lastNewline !== -1) {
				const err = parseSSELines(text.substring(0, lastNewline), onProgress);
				if (err) serverError = err;
				// Keep only the unparsed tail as raw bytes
				const parsedByteLen = new TextEncoder().encode(text.substring(0, lastNewline + 1)).length;
				pendingBytes = [accumulated.slice(parsedByteLen)];
			}
			// else: keep accumulating
		}
	}

	// Handle leftover SSE (stream ended without binary)
	if (!binaryStarted && pendingBytes.length > 0) {
		const leftoverText = decoder.decode(concatBytes(pendingBytes));
		if (leftoverText.trim()) {
			const err = parseSSELines(leftoverText, onProgress);
			if (err) serverError = err;
		}
	}

	if (serverError) {
		return { success: false, error: serverError };
	}

	if (chunks.length === 0) {
		return { success: false, error: "No video data received" };
	}

	const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
	const buffer = new ArrayBuffer(totalLength);
	const view = new Uint8Array(buffer);
	let offset = 0;
	for (const chunk of chunks) {
		view.set(chunk, offset);
		offset += chunk.length;
	}

	return { success: true, buffer };
}

/**
 * Export only the animation overlay as a standalone MP4 using @remotion/renderer.
 * Frame-accurate, smooth rendering — no jitter. Zero WebCodecs/VAAPI, zero SIGILL risk.
 */
export async function exportAnimationOnly({
	projectId,
	fps,
	duration,
	width,
	height,
	quality,
	onProgress,
}: {
	projectId: string;
	fps: number;
	duration: number;
	width: number;
	height: number;
	quality: ExportQuality;
	onProgress?: (progress: number) => void;
}): Promise<{ success: boolean; buffer?: ArrayBuffer; error?: string }> {
	const animationScenes = await gatherAnimationScenes({ projectId });
	if (animationScenes.length === 0) {
		return { success: false, error: "No animation scenes found for this project" };
	}

	// Use @remotion/renderer for frame-accurate, smooth animation rendering
	const response = await fetch("/api/render-animation", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			scenes: animationScenes,
			fps,
			duration,
			width,
			height,
			quality,
		}),
	});

	if (!response.ok) {
		const err = await response.json().catch(() => ({ error: response.statusText }));
		return { success: false, error: err.error || "Animation export failed" };
	}

	const reader = response.body?.getReader();
	if (!reader) return { success: false, error: "No response stream" };

	// Parse the SSE + binary streaming protocol (same as callServerExport)
	const chunks: Uint8Array[] = [];
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const BOUNDARY = "\n---BINARY_START---\n";
	const boundaryBytes = encoder.encode(BOUNDARY);
	let binaryStarted = false;
	let pendingBytes: Uint8Array[] = [];
	let serverError: string | null = null;

	function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
		outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
			for (let j = 0; j < needle.length; j++) {
				if (haystack[i + j] !== needle[j]) continue outer;
			}
			return i;
		}
		return -1;
	}

	function concatBytes(arrays: Uint8Array[]): Uint8Array {
		const total = arrays.reduce((s, a) => s + a.length, 0);
		const result = new Uint8Array(total);
		let off = 0;
		for (const a of arrays) { result.set(a, off); off += a.length; }
		return result;
	}

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		if (binaryStarted) { chunks.push(value); continue; }

		pendingBytes.push(value);
		const accumulated = concatBytes(pendingBytes);
		const boundaryIdx = findBytes(accumulated, boundaryBytes);

		if (boundaryIdx !== -1) {
			const sseText = decoder.decode(accumulated.slice(0, boundaryIdx));
			const err = parseSSELines(sseText, onProgress ? (p) => onProgress(p) : undefined);
			if (err) serverError = err;
			const afterBoundary = accumulated.slice(boundaryIdx + boundaryBytes.length);
			if (afterBoundary.length > 0) chunks.push(afterBoundary);
			binaryStarted = true;
			pendingBytes = [];
		} else {
			const text = decoder.decode(accumulated, { stream: true });
			const lastNewline = text.lastIndexOf("\n");
			if (lastNewline !== -1) {
				const err = parseSSELines(text.substring(0, lastNewline), onProgress ? (p) => onProgress(p) : undefined);
				if (err) serverError = err;
				const parsedByteLen = encoder.encode(text.substring(0, lastNewline + 1)).length;
				pendingBytes = [accumulated.slice(parsedByteLen)];
			}
		}
	}

	if (serverError) return { success: false, error: serverError };
	if (chunks.length === 0) return { success: false, error: "No video data received" };

	const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
	const buffer = new ArrayBuffer(totalLength);
	const view = new Uint8Array(buffer);
	let offset = 0;
	for (const chunk of chunks) { view.set(chunk, offset); offset += chunk.length; }

	return { success: true, buffer };
}

/**
 * Export the face-cam video track with all cuts applied.
 * Uploads raw video files, trims & concatenates them server-side with FFmpeg.
 * No re-encoding — fast stream copy preserves original quality.
 */
export async function exportFaceVideo({
	tracks,
	mediaAssets,
	projectName,
	onProgress,
}: {
	tracks: import("@/types/timeline").TimelineTrack[];
	mediaAssets: MediaAsset[];
	projectName: string;
	onProgress?: (progress: number) => void;
}): Promise<{ success: boolean; buffer?: ArrayBuffer; error?: string }> {
	const mediaMap = new Map(mediaAssets.map((a) => [a.id, a]));

	// Collect all video elements from non-main video tracks, sorted by timeline position
	const segments: { serverPath?: string; file: File; trimStart: number; duration: number; timelineStart: number }[] = [];
	for (const track of tracks) {
		if (track.type !== "video") continue;
		// include all video tracks (main face cam or secondary PIP)
		for (const element of track.elements) {
			if (element.type !== "video") continue;
			const asset = mediaMap.get((element as import("@/types/timeline").VideoElement).mediaId);
			if (!asset?.file) continue;
			segments.push({
				file: asset.file as File,
				trimStart: element.trimStart,
				duration: element.duration,
				timelineStart: element.startTime,
			});
		}
	}

	if (segments.length === 0) {
		return { success: false, error: "No face cam video clips found on non-main tracks" };
	}

	// Sort by timeline position
	segments.sort((a, b) => a.timelineStart - b.timelineStart);

	// Upload each raw file to the server
	const uploaded: MainVideoSegment[] = [];
	for (const seg of segments) {
		const serverPath = await uploadBlob({ blob: seg.file, filename: `face-${Date.now()}.mp4` });
		uploaded.push({
			serverPath,
			trimStart: seg.trimStart,
			duration: seg.duration,
			timelineStart: seg.timelineStart,
		});
	}

	// Call the server to trim + concatenate
	const response = await fetch("/api/export-video", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			animationScenes: [],
			fps: 30,
			duration: segments.reduce((sum, s) => sum + s.duration, 0),
			width: 1080,
			height: 1920,
			format: "mp4",
			quality: "high",
			includeAudio: true,
			faceVideoOnly: true,
			faceVideoSegments: uploaded,
		}),
	});

	if (!response.ok) {
		const err = await response.json().catch(() => ({ error: response.statusText }));
		return { success: false, error: err.error || "Face video export failed" };
	}

	const reader = response.body?.getReader();
	if (!reader) return { success: false, error: "No response stream" };

	const chunks: Uint8Array[] = [];
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const BOUNDARY = "\n---BINARY_START---\n";
	const boundaryBytes = encoder.encode(BOUNDARY);
	let binaryStarted = false;
	let pendingBytes: Uint8Array[] = [];
	let serverError: string | null = null;

	function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
		outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
			for (let j = 0; j < needle.length; j++) {
				if (haystack[i + j] !== needle[j]) continue outer;
			}
			return i;
		}
		return -1;
	}

	function concatBytes(arrays: Uint8Array[]): Uint8Array {
		const total = arrays.reduce((s, a) => s + a.length, 0);
		const result = new Uint8Array(total);
		let off = 0;
		for (const a of arrays) { result.set(a, off); off += a.length; }
		return result;
	}

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (binaryStarted) { chunks.push(value); continue; }
		pendingBytes.push(value);
		const accumulated = concatBytes(pendingBytes);
		const boundaryIdx = findBytes(accumulated, boundaryBytes);
		if (boundaryIdx !== -1) {
			const sseText = decoder.decode(accumulated.slice(0, boundaryIdx));
			const err = parseSSELines(sseText, onProgress ? (p) => onProgress(p) : undefined);
			if (err) serverError = err;
			const afterBoundary = accumulated.slice(boundaryIdx + boundaryBytes.length);
			if (afterBoundary.length > 0) chunks.push(afterBoundary);
			binaryStarted = true;
			pendingBytes = [];
		} else {
			const text = decoder.decode(accumulated, { stream: true });
			const lastNewline = text.lastIndexOf("\n");
			if (lastNewline !== -1) {
				const err = parseSSELines(text.substring(0, lastNewline), onProgress ? (p) => onProgress(p) : undefined);
				if (err) serverError = err;
				const parsedByteLen = encoder.encode(text.substring(0, lastNewline + 1)).length;
				pendingBytes = [accumulated.slice(parsedByteLen)];
			}
		}
	}

	if (serverError) return { success: false, error: serverError };
	if (chunks.length === 0) return { success: false, error: "No video data received" };

	const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
	const buffer = new ArrayBuffer(totalLength);
	const view = new Uint8Array(buffer);
	let offset = 0;
	for (const chunk of chunks) { view.set(chunk, offset); offset += chunk.length; }
	return { success: true, buffer };
}

/**
 * Parse SSE lines and call onProgress. Returns error message if an error event is found.
 */
function parseSSELines(
	text: string,
	onProgress?: (progress: number, stage: string) => void,
): string | null {
	let error: string | null = null;
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || !trimmed.startsWith("data:")) continue;
		try {
			const event: SSEEvent = JSON.parse(trimmed.substring(5));
			if (event.type === "progress" && onProgress) {
				onProgress(event.progress, event.stage);
			} else if (event.type === "error") {
				error = event.error;
			}
		} catch {
			// skip malformed lines
		}
	}
	return error;
}
