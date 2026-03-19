/**
 * Renders compiled Remotion scene components to canvas for export.
 *
 * Pre-renders all animation frames upfront into a cache,
 * then the export loop draws from cache + composites PiP face cam.
 */

import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import html2canvas from "html2canvas";
import { EditorFrameContext } from "@/lib/remotion-renderer/compile";
import { compileForEditorOverlay } from "@/lib/remotion-renderer/compile";
import { getSceneRemotionCode } from "@/lib/remotion-renderer/scene-code-store";
import { getSceneDirection } from "@/lib/scene-planner/scene-direction-store";
import { getProjectBoundaries } from "@/lib/scene-planner/boundaries-store";
import type { PlannedScene } from "@/lib/scene-planner/schema";

interface CompiledExportScene {
	sceneId: number;
	startTime: number;
	endTime: number;
	Component: React.FC<{ scene: PlannedScene }>;
	direction: PlannedScene;
}

const COMP_WIDTH = 1080;
const COMP_HEIGHT = 1920;

// PiP face cam constants (matching animation-overlay.tsx reel-28 style)
const PIP = {
	left: 40,
	bottom: 150,
	width: 440,
	height: 580,
	borderRadius: 24,
	borderWidth: 5,
	borderColor: "#F5C518",
	shadowBlur: 40,
	shadowColor: "rgba(245, 197, 24, 0.45)",
	bgColor: "#111",
} as const;

export async function compileExportScenes({
	projectId,
}: {
	projectId: string;
}): Promise<CompiledExportScene[]> {
	const boundaries = await getProjectBoundaries({ projectId });
	if (!boundaries) return [];

	const scenes: CompiledExportScene[] = [];
	for (const b of boundaries.boundaries) {
		const [direction, codeResult] = await Promise.all([
			getSceneDirection({ projectId, sceneId: b.id }),
			getSceneRemotionCode({ projectId, sceneId: b.id }),
		]);
		if (!direction || !codeResult) continue;

		const compiled = compileForEditorOverlay(codeResult.code);
		if (!compiled.Component) {
			console.warn(`[AnimationExport] Scene ${b.id} compile failed:`, compiled.error);
			continue;
		}
		scenes.push({
			sceneId: b.id,
			startTime: b.startTime,
			endTime: b.endTime,
			Component: compiled.Component as unknown as React.FC<{ scene: PlannedScene }>,
			direction,
		});
	}
	return scenes;
}


export class AnimationFrameRenderer {
	private scenes: CompiledExportScene[];
	private fps: number;
	private frameCache = new Map<string, HTMLCanvasElement>();

	constructor({ scenes, fps }: { scenes: CompiledExportScene[]; fps: number }) {
		this.scenes = scenes;
		this.fps = fps;
	}

	/**
	 * Pre-render all animation frames (Remotion component only, no PiP video).
	 */
	async preRender({
		onProgress,
	}: { onProgress?: (progress: number) => void } = {}): Promise<void> {
		const sceneFrames = this.scenes.map((s) => ({
			scene: s,
			count: Math.ceil((s.endTime - s.startTime) * this.fps),
		}));
		const total = sceneFrames.reduce((sum, s) => sum + s.count, 0);
		if (total === 0) return;

		const container = document.createElement("div");
		container.style.cssText = `
			position: fixed; left: -${COMP_WIDTH + 100}px; top: 0;
			width: ${COMP_WIDTH}px; height: ${COMP_HEIGHT}px;
			overflow: hidden; background: transparent; z-index: -9999;
		`;
		document.body.appendChild(container);
		const root = createRoot(container);

		let done = 0;
		try {
			for (const { scene, count } of sceneFrames) {
				for (let frame = 0; frame < count; frame++) {
					flushSync(() => {
						root.render(
							React.createElement(
								EditorFrameContext.Provider,
								{ value: { frame, fps: this.fps } },
								React.createElement(scene.Component, { scene: scene.direction }),
							),
						);
					});

					const captured = await html2canvas(container, {
						width: COMP_WIDTH,
						height: COMP_HEIGHT,
						backgroundColor: null,
						scale: 1,
						logging: false,
						useCORS: true,
					});
					this.frameCache.set(`${scene.sceneId}:${frame}`, captured);
					done++;
					onProgress?.(done / total);
				}
			}
		} finally {
			try { root.unmount(); } catch { /* */ }
			container.remove();
		}
		console.log(`[AnimationExport] Pre-rendered ${done} frames`);
	}

	/**
	 * Composite animation + PiP face cam onto the export canvas.
	 *
	 * @param baseRenderer - the CanvasRenderer that already rendered the base video frame.
	 *   We grab the current video frame from it to draw into the PiP area.
	 */
	async renderFrame({
		time,
		ctx,
		canvasWidth,
		canvasHeight,
		baseCanvas,
	}: {
		time: number;
		ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
		canvasWidth: number;
		canvasHeight: number;
		/** The canvas that has the base video frame already rendered */
		baseCanvas?: HTMLCanvasElement | OffscreenCanvas;
	}): Promise<boolean> {
		const scene = this.scenes.find((s) => time >= s.startTime && time < s.endTime);
		if (!scene) return false;

		const sceneFrame = Math.floor((time - scene.startTime) * this.fps);
		const cached = this.frameCache.get(`${scene.sceneId}:${sceneFrame}`);
		if (!cached) return false;

		// 1. Clear and draw the animation frame (replaces the base video)
		ctx.clearRect(0, 0, canvasWidth, canvasHeight);
		ctx.drawImage(cached, 0, 0, canvasWidth, canvasHeight);

		// 2. Draw PiP face cam on top using the base video frame
		if (baseCanvas) {
			this.drawPipFaceCam({ ctx, canvasWidth, canvasHeight, baseCanvas });
		}

		return true;
	}

	private drawPipFaceCam({
		ctx,
		canvasWidth,
		canvasHeight,
		baseCanvas,
	}: {
		ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
		canvasWidth: number;
		canvasHeight: number;
		baseCanvas: HTMLCanvasElement | OffscreenCanvas;
	}): void {
		// Scale PiP coordinates from composition space to canvas space
		const sx = canvasWidth / COMP_WIDTH;
		const sy = canvasHeight / COMP_HEIGHT;

		const x = PIP.left * sx;
		const y = (COMP_HEIGHT - PIP.bottom - PIP.height) * sy;
		const w = PIP.width * sx;
		const h = PIP.height * sy;
		const r = PIP.borderRadius * Math.min(sx, sy);
		const bw = PIP.borderWidth * Math.min(sx, sy);

		ctx.save();

		// Shadow
		ctx.shadowColor = PIP.shadowColor;
		ctx.shadowBlur = PIP.shadowBlur * Math.min(sx, sy);

		// Draw rounded rect background
		this.roundRect(ctx, x, y, w, h, r);
		ctx.fillStyle = PIP.bgColor;
		ctx.fill();

		// Reset shadow before drawing content
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;

		// Clip to rounded rect and draw the base video frame inside (object-fit: cover)
		ctx.beginPath();
		this.roundRect(ctx, x + bw, y + bw, w - bw * 2, h - bw * 2, r - bw);
		ctx.clip();

		// Calculate "cover" crop from source
		const innerW = w - bw * 2;
		const innerH = h - bw * 2;
		const srcW = "width" in baseCanvas ? baseCanvas.width : (baseCanvas as HTMLCanvasElement).width;
		const srcH = "height" in baseCanvas ? baseCanvas.height : (baseCanvas as HTMLCanvasElement).height;
		const srcAspect = srcW / srcH;
		const dstAspect = innerW / innerH;

		let cropX = 0;
		let cropY = 0;
		let cropW = srcW;
		let cropH = srcH;

		if (srcAspect > dstAspect) {
			// Source is wider — crop sides
			cropW = srcH * dstAspect;
			cropX = (srcW - cropW) / 2;
		} else {
			// Source is taller — crop top/bottom
			cropH = srcW / dstAspect;
			cropY = (srcH - cropH) / 2;
		}

		ctx.drawImage(baseCanvas, cropX, cropY, cropW, cropH, x + bw, y + bw, innerW, innerH);

		ctx.restore();

		// Draw border on top
		ctx.save();
		this.roundRect(ctx, x, y, w, h, r);
		ctx.strokeStyle = PIP.borderColor;
		ctx.lineWidth = bw;
		ctx.stroke();
		ctx.restore();
	}

	private roundRect(
		ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
		x: number, y: number, w: number, h: number, r: number,
	): void {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.lineTo(x + w - r, y);
		ctx.quadraticCurveTo(x + w, y, x + w, y + r);
		ctx.lineTo(x + w, y + h - r);
		ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
		ctx.lineTo(x + r, y + h);
		ctx.quadraticCurveTo(x, y + h, x, y + h - r);
		ctx.lineTo(x, y + r);
		ctx.quadraticCurveTo(x, y, x + r, y);
		ctx.closePath();
	}

	dispose(): void {
		this.frameCache.clear();
	}
}
