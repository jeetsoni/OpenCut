/**
 * Captures PNG screenshots of a compiled Remotion scene component at beat midpoints.
 *
 * Used by the vision review pipeline (Option C) to feed actual rendered frames
 * to the vision model for layout QA.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { EditorFrameContext, compileForEditorOverlay } from "@/lib/remotion-renderer/compile";
import type { PlannedScene } from "@/lib/scene-planner/schema";

const COMP_WIDTH = 1080;
const CANVAS_TOP = 80;
const CANVAS_H = 1080;
// Capture the safe zone at half resolution → 540×540 PNG
const CAPTURE_SCALE = 0.5;

/**
 * Renders the scene component at beat midpoints and returns base64 PNG strings
 * of the safe zone (y=80 to y=1160 in composition space).
 *
 * Returns an empty array on any failure so callers can skip vision review gracefully.
 */
export async function captureSceneFrames(
	code: string,
	scene: PlannedScene,
): Promise<string[]> {
	const compiled = compileForEditorOverlay(code);
	if (!compiled.Component) return [];

	const Component = compiled.Component as React.FC<{ scene: PlannedScene }>;
	const fps = 30;

	// Pick one frame per beat (midpoint), clamped to scene duration
	const beats = scene.animationDirection?.beats ?? [];
	const framesToCapture: number[] = [];
	for (const beat of beats) {
		const absMid = Math.round((beat.frameRange[0] + beat.frameRange[1]) / 2);
		const relFrame = absMid - scene.startFrame;
		const clamped = Math.max(0, Math.min(relFrame, scene.durationFrames - 1));
		if (!framesToCapture.includes(clamped)) {
			framesToCapture.push(clamped);
		}
	}
	// Fallback: capture middle frame
	if (framesToCapture.length === 0) {
		framesToCapture.push(Math.round(scene.durationFrames / 2));
	}

	// Create a hidden off-screen container at full composition size
	const container = document.createElement("div");
	container.style.cssText = `
		position: fixed;
		left: -${COMP_WIDTH + 200}px;
		top: 0;
		width: ${COMP_WIDTH}px;
		height: 1920px;
		overflow: hidden;
		background: #111318;
		z-index: -9999;
	`;
	document.body.appendChild(container);
	const root = createRoot(container);

	const { default: html2canvasFn } = await import("html2canvas");

	const frames: string[] = [];
	try {
		for (const frame of framesToCapture) {
			flushSync(() => {
				root.render(
					React.createElement(
						EditorFrameContext.Provider,
						{ value: { frame, fps } },
						React.createElement(Component, { scene }),
					),
				);
			});

			// Let the browser settle any async layout/paint
			await new Promise<void>((r) => setTimeout(r, 60));

			// Capture only the safe zone (y=CANVAS_TOP to y=CANVAS_TOP+CANVAS_H)
			const captured = await html2canvasFn(container, {
				x: 0,
				y: CANVAS_TOP,
				width: COMP_WIDTH,
				height: CANVAS_H,
				scale: CAPTURE_SCALE,
				backgroundColor: "#111318",
				logging: false,
				useCORS: true,
			});

			const dataUrl = captured.toDataURL("image/png");
			const base64 = dataUrl.split(",")[1];
			if (base64) frames.push(base64);
		}
	} finally {
		try {
			root.unmount();
		} catch {
			/* ignore */
		}
		container.remove();
	}

	return frames;
}

/**
 * Captures a single PNG frame at a specific absolute playback time.
 * Returns a base64 PNG string (without the data:image/png;base64, prefix)
 * or null on any failure, so callers can degrade gracefully.
 */
export async function captureFrameAtTime(
	code: string,
	scene: PlannedScene,
	absoluteTimeSeconds: number,
): Promise<string | null> {
	try {
		const compiled = compileForEditorOverlay(code);
		if (!compiled.Component) return null;

		const Component = compiled.Component as React.FC<{ scene: PlannedScene }>;
		const fps = 30;
		const relFrame = Math.round((absoluteTimeSeconds - scene.startTime) * fps);
		const frame = Math.max(0, Math.min(relFrame, scene.durationFrames - 1));

		const container = document.createElement("div");
		container.style.cssText = `
			position: fixed;
			left: -${COMP_WIDTH + 200}px;
			top: 0;
			width: ${COMP_WIDTH}px;
			height: 1920px;
			overflow: hidden;
			background: #111318;
			z-index: -9999;
		`;
		document.body.appendChild(container);
		const root = createRoot(container);
		const { default: html2canvasFn } = await import("html2canvas");

		try {
			flushSync(() => {
				root.render(
					React.createElement(
						EditorFrameContext.Provider,
						{ value: { frame, fps } },
						React.createElement(Component, { scene }),
					),
				);
			});

			await new Promise<void>((r) => setTimeout(r, 60));

			const captured = await html2canvasFn(container, {
				x: 0,
				y: CANVAS_TOP,
				width: COMP_WIDTH,
				height: CANVAS_H,
				scale: CAPTURE_SCALE,
				backgroundColor: "#111318",
				logging: false,
				useCORS: true,
			});

			const dataUrl = captured.toDataURL("image/png");
			const base64 = dataUrl.split(",")[1];
			return base64 ?? null;
		} finally {
			try { root.unmount(); } catch { /* ignore */ }
			container.remove();
		}
	} catch {
		return null;
	}
}
