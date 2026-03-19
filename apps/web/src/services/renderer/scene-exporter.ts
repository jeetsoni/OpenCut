import EventEmitter from "eventemitter3";

import {
	Output,
	Mp4OutputFormat,
	WebMOutputFormat,
	BufferTarget,
	CanvasSource,
	AudioBufferSource,
	QUALITY_LOW,
	QUALITY_MEDIUM,
	QUALITY_HIGH,
	QUALITY_VERY_HIGH,
} from "mediabunny";
import type { RootNode } from "./nodes/root-node";
import type { ExportFormat, ExportQuality } from "@/types/export";
import { CanvasRenderer } from "./canvas-renderer";

type ExportParams = {
	width: number;
	height: number;
	fps: number;
	format: ExportFormat;
	quality: ExportQuality;
	shouldIncludeAudio?: boolean;
	audioBuffer?: AudioBuffer;
};

const qualityMap = {
	low: QUALITY_LOW,
	medium: QUALITY_MEDIUM,
	high: QUALITY_HIGH,
	very_high: QUALITY_VERY_HIGH,
};

export type SceneExporterEvents = {
	progress: [progress: number];
	complete: [buffer: ArrayBuffer];
	error: [error: Error];
	cancelled: [];
};

export class SceneExporter extends EventEmitter<SceneExporterEvents> {
	private renderer: CanvasRenderer;
	private format: ExportFormat;
	private quality: ExportQuality;
	private shouldIncludeAudio: boolean;
	private audioBuffer?: AudioBuffer;
	private _baseSnapshotCanvas?: HTMLCanvasElement;

	private isCancelled = false;

	constructor({
		width,
		height,
		fps,
		format,
		quality,
		shouldIncludeAudio,
		audioBuffer,
	}: ExportParams) {
		super();
		this.renderer = new CanvasRenderer({
			width,
			height,
			fps,
		});

		this.format = format;
		this.quality = quality;
		this.shouldIncludeAudio = shouldIncludeAudio ?? false;
		this.audioBuffer = audioBuffer;
	}

	cancel(): void {
		this.isCancelled = true;
	}

	async export({
		rootNode,
		animationRenderer,
	}: {
		rootNode: RootNode;
		animationRenderer?: { renderFrame: (params: { time: number; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D; canvasWidth: number; canvasHeight: number; baseCanvas?: HTMLCanvasElement | OffscreenCanvas }) => Promise<boolean> };
	}): Promise<ArrayBuffer | null> {
		const { fps } = this.renderer;
		const frameCount = Math.ceil(rootNode.duration * fps);

		const outputFormat =
			this.format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();

		const output = new Output({
			format: outputFormat,
			target: new BufferTarget(),
		});

		const videoSource = new CanvasSource(this.renderer.canvas, {
			codec: this.format === "webm" ? "vp9" : "avc",
			bitrate: qualityMap[this.quality],
		});

		output.addVideoTrack(videoSource, { frameRate: fps });

		let audioSource: AudioBufferSource | null = null;
		if (this.shouldIncludeAudio && this.audioBuffer) {
			let audioCodec: "aac" | "opus" =
				this.format === "webm" ? "opus" : "aac";

			if (audioCodec === "aac" && typeof AudioEncoder !== "undefined") {
				const { supported } = await AudioEncoder.isConfigSupported({
					codec: "mp4a.40.2",
					sampleRate: this.audioBuffer.sampleRate,
					numberOfChannels: this.audioBuffer.numberOfChannels,
					bitrate: 192000,
				});
				if (!supported) audioCodec = "opus";
			}

			audioSource = new AudioBufferSource({
				codec: audioCodec,
				bitrate: qualityMap[this.quality],
			});
			output.addAudioTrack(audioSource);
		}

		await output.start();

		if (audioSource && this.audioBuffer) {
			await audioSource.add(this.audioBuffer);
			audioSource.close();
		}

		for (let i = 0; i < frameCount; i++) {
			if (this.isCancelled) {
				await output.cancel();
				this.emit("cancelled");
				return null;
			}

			const time = i / fps;
			await this.renderer.render({ node: rootNode, time });

			// Composite animation overlay on top if available
			if (animationRenderer) {
				try {
					// Reuse a single snapshot canvas instead of allocating per frame
					if (!this._baseSnapshotCanvas) {
						this._baseSnapshotCanvas = document.createElement("canvas");
						this._baseSnapshotCanvas.width = this.renderer.width;
						this._baseSnapshotCanvas.height = this.renderer.height;
					}
					const snapCtx = this._baseSnapshotCanvas.getContext("2d");
					if (snapCtx) {
						snapCtx.drawImage(this.renderer.canvas, 0, 0);
					}

					const ctx = this.renderer.context;
					await animationRenderer.renderFrame({
						time,
						ctx,
						canvasWidth: this.renderer.width,
						canvasHeight: this.renderer.height,
						baseCanvas: this._baseSnapshotCanvas,
					});
				} catch (err) {
					console.warn("[Export] Animation frame failed at", time, err);
				}
			}

			await videoSource.add(time, 1 / fps);

			this.emit("progress", i / frameCount);
		}

		if (this.isCancelled) {
			await output.cancel();
			this.emit("cancelled");
			return null;
		}

		videoSource.close();
		await output.finalize();
		this.emit("progress", 1);

		const buffer = output.target.buffer;
		if (!buffer) {
			this.emit("error", new Error("Failed to export video"));
			return null;
		}

		this.emit("complete", buffer);
		return buffer;
	}
}
