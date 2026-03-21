/**
 * Video frame cache using HTMLVideoElement.
 *
 * Previously used mediabunny's CanvasSink which routes through WebCodecs
 * VideoDecoder → VAAPI (hardware decoder) on Linux. VAAPI accumulates GPU
 * memory over time and eventually kills Chrome's renderer process with SIGILL
 * on long videos (1min+) or complex multi-track projects.
 *
 * HTMLVideoElement uses the browser's built-in media pipeline which:
 * - Streams video from an object URL (low memory, no full-file buffering)
 * - Has mature memory management built into the browser
 * - Does not accumulate decoder state the way WebCodecs does
 * - Is universally stable across Linux/VAAPI configurations
 */

interface VideoEntry {
	video: HTMLVideoElement;
	objectUrl: string;
}

export class VideoCache {
	private videos = new Map<string, VideoEntry>();
	private initPromises = new Map<string, Promise<void>>();

	async getFrameAt({
		mediaId,
		file,
		time,
	}: {
		mediaId: string;
		file: File;
		time: number;
	}): Promise<{ source: CanvasImageSource; width: number; height: number } | null> {
		await this.ensureVideo({ mediaId, file });

		const entry = this.videos.get(mediaId);
		if (!entry) return null;

		const { video } = entry;

		// Seek to the requested time if not already there (half-frame tolerance)
		const tolerance = 1 / 120;
		if (Math.abs(video.currentTime - time) > tolerance) {
			await this.seekTo({ video, time });
		}

		if (video.readyState < 2 /* HAVE_CURRENT_DATA */) {
			return null;
		}

		return {
			source: video,
			width: video.videoWidth,
			height: video.videoHeight,
		};
	}

	private seekTo({
		video,
		time,
	}: {
		video: HTMLVideoElement;
		time: number;
	}): Promise<void> {
		return new Promise<void>((resolve) => {
			const onSeeked = () => {
				video.removeEventListener("seeked", onSeeked);
				resolve();
			};
			video.addEventListener("seeked", onSeeked);
			video.currentTime = time;
		});
	}

	private async ensureVideo({
		mediaId,
		file,
	}: {
		mediaId: string;
		file: File;
	}): Promise<void> {
		if (this.videos.has(mediaId)) return;

		if (this.initPromises.has(mediaId)) {
			await this.initPromises.get(mediaId);
			return;
		}

		const initPromise = this.initializeVideo({ mediaId, file });
		this.initPromises.set(mediaId, initPromise);
		try {
			await initPromise;
		} finally {
			this.initPromises.delete(mediaId);
		}
	}

	private initializeVideo({
		mediaId,
		file,
	}: {
		mediaId: string;
		file: File;
	}): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (typeof document === "undefined") {
				reject(new Error("HTMLVideoElement not available (SSR context)"));
				return;
			}

			const objectUrl = URL.createObjectURL(file);
			const video = document.createElement("video");
			video.src = objectUrl;
			video.muted = true;
			video.preload = "auto";
			video.playsInline = true;

			const onMetadata = () => {
				video.removeEventListener("loadedmetadata", onMetadata);
				video.removeEventListener("error", onError);
				this.videos.set(mediaId, { video, objectUrl });
				resolve();
			};

			const onError = () => {
				video.removeEventListener("loadedmetadata", onMetadata);
				video.removeEventListener("error", onError);
				URL.revokeObjectURL(objectUrl);
				reject(new Error(`Failed to load video: ${file.name}`));
			};

			video.addEventListener("loadedmetadata", onMetadata);
			video.addEventListener("error", onError);
		});
	}

	clearVideo({ mediaId }: { mediaId: string }): void {
		const entry = this.videos.get(mediaId);
		if (entry) {
			entry.video.src = "";
			URL.revokeObjectURL(entry.objectUrl);
			this.videos.delete(mediaId);
		}
		this.initPromises.delete(mediaId);
	}

	clearAll(): void {
		for (const [mediaId] of this.videos) {
			this.clearVideo({ mediaId });
		}
	}

	getStats() {
		return {
			totalSinks: this.videos.size,
			activeSinks: this.videos.size,
			cachedFrames: this.videos.size,
		};
	}
}

export const videoCache = new VideoCache();

// Both preview and export now use the same stable HTMLVideoElement pipeline.
export const previewVideoCache = videoCache;
