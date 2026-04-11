import type { EditorCore } from "@/core";
import type { RootNode } from "@/services/renderer/nodes/root-node";
import type { ExportOptions, ExportResult } from "@/types/export";
import type { TimelineTrack, VideoTrack, VideoElement } from "@/types/timeline";
import type { MediaAsset } from "@/types/assets";
import type { TBackground } from "@/types/project";
import { CanvasRenderer } from "@/services/renderer/canvas-renderer";
import { SceneExporter } from "@/services/renderer/scene-exporter";
import { buildScene } from "@/services/renderer/scene-builder";
import { createTimelineAudioBuffer } from "@/lib/media/audio";
import { formatTimeCode, getLastFrameTime } from "@/lib/time";
import { downloadBlob } from "@/utils/browser";

export class RendererManager {
	private renderTree: RootNode | null = null;
	private listeners = new Set<() => void>();

	constructor(private editor: EditorCore) {}

	setRenderTree({ renderTree }: { renderTree: RootNode | null }): void {
		this.renderTree = renderTree;
		this.notify();
	}

	getRenderTree(): RootNode | null {
		return this.renderTree;
	}

	async saveSnapshot(): Promise<{ success: boolean; error?: string }> {
		try {
			const renderTree = this.getRenderTree();
			const activeProject = this.editor.project.getActive();

			if (!renderTree || !activeProject) {
				return { success: false, error: "No project or scene to capture" };
			}

			const duration = this.editor.timeline.getTotalDuration();
			if (duration === 0) {
				return { success: false, error: "Project is empty" };
			}

			const { canvasSize, fps } = activeProject.settings;
			const currentTime = this.editor.playback.getCurrentTime();
			const lastFrameTime = getLastFrameTime({ duration, fps });
			const renderTime = Math.min(currentTime, lastFrameTime);

			const renderer = new CanvasRenderer({
				width: canvasSize.width,
				height: canvasSize.height,
				fps,
			});

			const tempCanvas = document.createElement("canvas");
			tempCanvas.width = canvasSize.width;
			tempCanvas.height = canvasSize.height;

			await renderer.renderToCanvas({
				node: renderTree,
				time: renderTime,
				targetCanvas: tempCanvas,
			});

			const blob = await new Promise<Blob | null>((resolve) => {
				tempCanvas.toBlob((result) => resolve(result), "image/png");
			});

			if (!blob) {
				return { success: false, error: "Failed to create image" };
			}

			const timecode = formatTimeCode({
				timeInSeconds: renderTime,
				fps,
			}).replace(/:/g, "-");
			const safeName = activeProject.metadata.name
				.replace(/[<>:"/\\|?*]/g, "-")
				.trim() || "snapshot";
			const filename = `${safeName}-${timecode}.png`;

			downloadBlob({ blob, filename });
			return { success: true };
		} catch (error) {
			console.error("Save snapshot failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	async exportProject({
		options,
		onProgress,
		onCancel,
	}: {
		options: ExportOptions;
		onProgress?: ({ progress }: { progress: number }) => void;
		onCancel?: () => boolean;
	}): Promise<ExportResult> {
		const { format, quality, fps, includeAudio } = options;

		try {
			const tracks = this.editor.timeline.getTracks();
			const mediaAssets = this.editor.media.getAssets();
			const activeProject = this.editor.project.getActive();

			if (!activeProject) {
				return { success: false, error: "No active project" };
			}

			const duration = this.editor.timeline.getTotalDuration();
			if (duration === 0) {
				return { success: false, error: "Project is empty" };
			}

			const exportFps = fps || activeProject.settings.fps;
			const canvasSize = activeProject.settings.canvasSize;
			const projectId = activeProject.metadata.id;

			// Gather animation scenes unconditionally — the preview overlay toggle
			// controls visibility in the editor but must not gate the export.
			let animationScenes: import("@/services/renderer/server-export").AnimationSceneData[] = [];
			try {
				const { gatherAnimationScenes } = await import(
					"@/services/renderer/server-export"
				);
				animationScenes = await gatherAnimationScenes({ projectId });
				console.log(`[Export] Gathered ${animationScenes.length} animation scene(s) for project ${projectId}`);
				for (const s of animationScenes) {
					console.log(`[Export] Scene ${s.sceneId}: code length=${s.code.length}, first 120 chars:`, s.code.slice(0, 120));
				}
			} catch (err) {
				console.warn("[Export] Failed to gather animations:", err);
			}

			const hasAnimations = animationScenes.length > 0;

			// --- Step 1: Render base video (canvas layers, no animations) ---
			onProgress?.({ progress: 0.02 });

			let audioBuffer: AudioBuffer | null = null;
			if (includeAudio) {
				onProgress?.({ progress: 0.05 });
				audioBuffer = await createTimelineAudioBuffer({
					tracks,
					mediaAssets,
					duration,
				});
			}

			const scene = buildScene({
				tracks,
				mediaAssets,
				duration,
				canvasSize,
				background: activeProject.settings.background,
			});

			// If no animations, use the existing client-side export (fast, no server needed)
			if (!hasAnimations) {
				return await this.exportClientSide({
					scene,
					format,
					quality,
					fps: exportFps,
					includeAudio: !!includeAudio,
					audioBuffer,
					canvasSize,
					onProgress,
					onCancel,
				});
			}

			// --- Step 2: Get base video — fast path (raw upload) or SceneExporter ---
			const { uploadBlob, callServerExport } = await import(
				"@/services/renderer/server-export"
			);
			type VideoClipExportData = import("@/services/renderer/server-export").VideoClipExportData;
			type MainVideoSegment = import("@/services/renderer/server-export").MainVideoSegment;

			let baseVideoPath: string | undefined;
			let mainVideoSegments: MainVideoSegment[] | undefined;

			const fastPath = this.detectServerFastPath({
				tracks,
				mediaAssets,
				background: activeProject.settings.background,
			});

			if (fastPath) {
				// Fast path: upload raw video, skip SceneExporter entirely.
				// Avoids WebCodecs VideoEncoder → VAAPI → SIGILL crash on long videos.
				console.log("[Export] Fast path: uploading raw video, skipping SceneExporter");
				onProgress?.({ progress: 0.1 });
				const rawBlob = fastPath.asset.file as File;
				const rawServerPath = await uploadBlob({ blob: rawBlob, filename: "base-raw.mp4" });
				mainVideoSegments = [{
					serverPath: rawServerPath,
					trimStart: fastPath.element.trimStart,
					duration: fastPath.element.duration,
					timelineStart: fastPath.element.startTime,
				}];
				onProgress?.({ progress: 0.35 });
			} else {
				// Standard path: render base video canvas client-side
				onProgress?.({ progress: 0.08 });

				const baseExporter = new SceneExporter({
					width: canvasSize.width,
					height: canvasSize.height,
					fps: exportFps,
					format: "mp4",
					quality,
					shouldIncludeAudio: false,
				});

				let cancelled = false;
				baseExporter.on("progress", (progress) => {
					const adjusted = 0.08 + progress * 0.3;
					onProgress?.({ progress: adjusted });
				});

				const cancelCheck = setInterval(() => {
					if (onCancel?.()) {
						cancelled = true;
						baseExporter.cancel();
					}
				}, 100);

				const baseBuffer = await baseExporter.export({ rootNode: scene });
				clearInterval(cancelCheck);

				if (cancelled) return { success: false, cancelled: true };
				if (!baseBuffer) return { success: false, error: "Failed to render base video" };
				if (onCancel?.()) return { success: false, cancelled: true };

				onProgress?.({ progress: 0.4 });
				const baseBlob = new Blob([baseBuffer], { type: "video/mp4" });
				baseVideoPath = await uploadBlob({ blob: baseBlob, filename: "base.mp4" });
			}

			// --- Step 3: Upload audio and PiP clips ---
			let audioPath: string | undefined;
			if (includeAudio && audioBuffer) {
				onProgress?.({ progress: 0.42 });
				const audioBlob = await this.audioBufferToWav(audioBuffer);
				audioPath = await uploadBlob({ blob: audioBlob, filename: "audio.wav" });
			}

			// Upload video clips for PiP overlay (non-background video tracks)
			const videoClips: VideoClipExportData[] = [];
			const mediaMap = new Map(mediaAssets.map((a) => [a.id, a]));
			for (const track of tracks) {
				if (track.type !== "video") continue;
				for (const element of track.elements) {
					if (element.type !== "video") continue;
					const ve = element as VideoElement;
					const asset = mediaMap.get(ve.mediaId);
					if (!asset?.url) continue;
					// Skip the main background video already uploaded via fast path
					if (fastPath && asset.id === fastPath.asset.id) continue;
					try {
						const resp = await fetch(asset.url);
						const blob = await resp.blob();
						const clipPath = await uploadBlob({ blob, filename: `clip-${ve.id}.mp4` });
						videoClips.push({
							serverPath: clipPath,
							startTime: ve.startTime,
							duration: ve.duration,
							trimStart: ve.trimStart,
						});
					} catch (err) {
						console.warn(`[Export] Failed to upload video clip ${ve.id}:`, err);
					}
				}
			}

			if (onCancel?.()) return { success: false, cancelled: true };

			// --- Step 4: Server composites animations + encodes with ffmpeg ---
			onProgress?.({ progress: 0.45 });

			const result = await callServerExport({
				baseVideoPath,
				mainVideoSegments,
				audioPath,
				animationScenes,
				videoClips: videoClips.length > 0 ? videoClips : undefined,
				fps: exportFps,
				duration,
				width: canvasSize.width,
				height: canvasSize.height,
				format,
				quality,
				includeAudio: !!includeAudio,
				onProgress: (serverProgress, stage) => {
					const adjusted = 0.45 + serverProgress * 0.55;
					onProgress?.({ progress: adjusted });
				},
				onCancel,
			});

			if (result.cancelled) return { success: false, cancelled: true };
			if (!result.success) return { success: false, error: result.error };

			return { success: true, buffer: result.buffer };
		} catch (error) {
			console.error("Export failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown export error",
			};
		}
	}

	/**
	 * Detect if the project is simple enough to bypass client-side SceneExporter.
	 * Returns the main video element and asset if eligible, otherwise null.
	 *
	 * Eligible when: single background video with identity transform, no canvas
	 * overlays (text/sticker/image/effect), no blur background.
	 */
	private detectServerFastPath({
		tracks,
		mediaAssets,
		background,
	}: {
		tracks: TimelineTrack[];
		mediaAssets: MediaAsset[];
		background: TBackground;
	}): { element: VideoElement; asset: MediaAsset } | null {
		// Blur background requires canvas rendering
		if (background.type === "blur") return null;

		// Any non-hidden text/sticker/effect tracks require canvas rendering
		for (const track of tracks) {
			if ("hidden" in track && track.hidden) continue;
			if (track.type === "text" && track.elements.length > 0) return null;
			if (track.type === "sticker" && track.elements.length > 0) return null;
			if (track.type === "effect" && track.elements.length > 0) return null;
		}

		// Find the main video track
		const mainTrack = tracks.find(
			(t) => t.type === "video" && (t as VideoTrack).isMain,
		) as VideoTrack | undefined;
		if (!mainTrack) return null;

		// Main track must have exactly 1 video element (images need canvas rendering)
		const videoElements = mainTrack.elements.filter(
			(e): e is VideoElement => e.type === "video",
		);
		if (videoElements.length !== 1) return null;
		if (mainTrack.elements.some((e) => e.type === "image")) return null;

		const el = videoElements[0];

		// Video must start at timeline position 0 (no leading gap)
		if (el.startTime !== 0) return null;

		// Video must have identity transform (scale/rotation/position)
		if (el.transform.scale !== 1) return null;
		if (el.transform.rotate !== 0) return null;
		if (el.transform.position.x !== 0 || el.transform.position.y !== 0) return null;

		// Video must be fully opaque with no effects or non-normal blend mode
		if (el.opacity !== 1) return null;
		if (el.effects && el.effects.length > 0) return null;
		if (el.blendMode && el.blendMode !== "normal") return null;

		// Must have the raw file available for upload
		const mediaMap = new Map(mediaAssets.map((a) => [a.id, a]));
		const asset = mediaMap.get(el.mediaId);
		if (!asset?.file) return null;

		return { element: el, asset };
	}

	/**
	 * Client-side only export (no animations, no server needed).
	 * Uses the existing canvas + mediabunny pipeline.
	 */
	private async exportClientSide({
		scene,
		format,
		quality,
		fps,
		includeAudio,
		audioBuffer,
		canvasSize,
		onProgress,
		onCancel,
	}: {
		scene: RootNode;
		format: ExportOptions["format"];
		quality: ExportOptions["quality"];
		fps: number;
		includeAudio: boolean;
		audioBuffer: AudioBuffer | null;
		canvasSize: { width: number; height: number };
		onProgress?: ({ progress }: { progress: number }) => void;
		onCancel?: () => boolean;
	}): Promise<ExportResult> {
		const exporter = new SceneExporter({
			width: canvasSize.width,
			height: canvasSize.height,
			fps,
			format,
			quality,
			shouldIncludeAudio: includeAudio,
			audioBuffer: audioBuffer || undefined,
		});

		exporter.on("progress", (progress) => {
			const adjusted = includeAudio ? 0.05 + progress * 0.95 : progress;
			onProgress?.({ progress: adjusted });
		});

		let cancelled = false;
		const cancelInterval = setInterval(() => {
			if (onCancel?.()) {
				cancelled = true;
				exporter.cancel();
			}
		}, 100);

		try {
			const buffer = await exporter.export({ rootNode: scene });
			clearInterval(cancelInterval);

			if (cancelled) return { success: false, cancelled: true };
			if (!buffer) return { success: false, error: "Export failed to produce buffer" };

			return { success: true, buffer };
		} finally {
			clearInterval(cancelInterval);
		}
	}

	/**
	 * Convert an AudioBuffer to a WAV blob for uploading to the server.
	 */
	private async audioBufferToWav(audioBuffer: AudioBuffer): Promise<Blob> {
		const numChannels = audioBuffer.numberOfChannels;
		const sampleRate = audioBuffer.sampleRate;
		const length = audioBuffer.length;
		const bytesPerSample = 2; // 16-bit PCM
		const dataSize = length * numChannels * bytesPerSample;
		const buffer = new ArrayBuffer(44 + dataSize);
		const view = new DataView(buffer);

		// WAV header
		const writeString = (offset: number, str: string) => {
			for (let i = 0; i < str.length; i++) {
				view.setUint8(offset + i, str.charCodeAt(i));
			}
		};

		writeString(0, "RIFF");
		view.setUint32(4, 36 + dataSize, true);
		writeString(8, "WAVE");
		writeString(12, "fmt ");
		view.setUint32(16, 16, true); // chunk size
		view.setUint16(20, 1, true); // PCM format
		view.setUint16(22, numChannels, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
		view.setUint16(32, numChannels * bytesPerSample, true);
		view.setUint16(34, bytesPerSample * 8, true);
		writeString(36, "data");
		view.setUint32(40, dataSize, true);

		// Interleave channels and write 16-bit PCM samples
		const channels: Float32Array[] = [];
		for (let ch = 0; ch < numChannels; ch++) {
			channels.push(audioBuffer.getChannelData(ch));
		}

		let offset = 44;
		for (let i = 0; i < length; i++) {
			for (let ch = 0; ch < numChannels; ch++) {
				const sample = Math.max(-1, Math.min(1, channels[ch][i]));
				view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
				offset += 2;
			}
		}

		return new Blob([buffer], { type: "audio/wav" });
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => fn());
	}
}
