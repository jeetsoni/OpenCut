/**
 * POST /api/export-video
 *
 * Unified server-side video export endpoint.
 *
 * Strategy:
 * 1. Render animation overlay frames via Puppeteer (headless Chrome)
 *    using the same Remotion shim components the preview uses
 * 2. Receive base video frames from the client (canvas-rendered)
 *    OR render them server-side via the same canvas pipeline
 * 3. Composite animation frames on top of base frames using ffmpeg
 * 4. Mux audio and return the final MP4
 *
 * For the initial implementation, we use a hybrid approach:
 * - Animation frames are rendered server-side via Puppeteer
 * - The client sends pre-rendered base frames as a video blob
 * - ffmpeg composites them together
 *
 * Request body (JSON):
 * {
 *   animationScenes: [{ sceneId, code, direction, startTime, endTime }],
 *   fps: number,
 *   duration: number,
 *   width: number,
 *   height: number,
 *   baseVideoPath?: string,  // path from upload-media if base video pre-rendered
 *   format: "mp4" | "webm",
 *   quality: "low" | "medium" | "high" | "very_high",
 *   includeAudio: boolean,
 * }
 */

import { type NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";

export const maxDuration = 900; // 15 min for long videos with many segments

interface AnimationScene {
	sceneId: number;
	code: string;
	direction: Record<string, unknown>;
	startTime: number;
	endTime: number;
}

interface ExportRequest {
	animationScenes: AnimationScene[];
	fps: number;
	duration: number;
	width: number;
	height: number;
	baseVideoPath?: string;
	/** Raw video segments to build the base from (skips client-side SceneExporter) */
	mainVideoSegments?: MainVideoSegmentData[];
	format: "mp4" | "webm";
	quality: "low" | "medium" | "high" | "very_high";
	includeAudio: boolean;
	audioPath?: string;
	/** Video clips for PiP overlay (face cam in bottom-left during animation scenes) */
	videoClips?: VideoClipData[];
	/** When true, export only the animation overlay as a standalone video (no base video needed) */
	animationOnly?: boolean;
	/** When true, concatenate faceVideoSegments into a standalone video (no base video needed) */
	faceVideoOnly?: boolean;
	/** Ordered face-cam segments to concatenate for faceVideoOnly export */
	faceVideoSegments?: MainVideoSegmentData[];
}

interface VideoClipData {
	/** Server-side path to the uploaded video file */
	serverPath: string;
	startTime: number;
	duration: number;
	trimStart: number;
}

interface MainVideoSegmentData {
	/** Server-side path to the raw video file */
	serverPath: string;
	trimStart: number;
	duration: number;
	timelineStart: number;
}

/** CRF values for libx264 (lower = higher quality, 0 = lossless) */
const QUALITY_CRF: Record<string, number> = {
	low: 23,
	medium: 18,
	high: 15,
	very_high: 10,
};

/** Bitrate fallback for WebM (VP9 doesn't use CRF the same way) */
const QUALITY_BITRATE_WEBM: Record<string, string> = {
	low: "2M",
	medium: "5M",
	high: "10M",
	very_high: "20M",
};

/** x264 preset per quality — slower = better compression efficiency */
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
	const encoder = new TextEncoder();
	controller.enqueue(encoder.encode(`data:${JSON.stringify(event)}\n`));
}

/**
 * Generate the inline JavaScript that sets up the Remotion shim layer,
 * compiles scenes, and exposes the __renderFrame API.
 * This runs inside Puppeteer via page.evaluate() after React is loaded.
 */
function generateAnimationScript({
	scenes,
	width,
	height,
	fps,
}: {
	scenes: AnimationScene[];
	width: number;
	height: number;
	fps: number;
}): string {
	return `
// --- Remotion shim layer (same as editor overlay) ---
const AbsoluteFill = ({ children, style, ...props }) => {
  return React.createElement('div', {
    ...props,
    style: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      display: 'flex', flexDirection: 'column',
      ...style,
    },
  }, children);
};

const _fps = ${fps};
const FrameContext = React.createContext({ frame: 0, fps: ${fps} });

function useCurrentFrame() {
  return React.useContext(FrameContext).frame;
}

function useVideoConfig() {
  const { fps } = React.useContext(FrameContext);
  return {
    fps, width: ${width}, height: ${height},
    durationInFrames: 99999, id: 'export', defaultCodec: 'h264',
  };
}

function interpolate(frame, inputRange, outputRange, options = {}) {
  const { extrapolateLeft = 'extend', extrapolateRight = 'extend' } = options;
  if (inputRange.length < 2 || outputRange.length < 2) return outputRange[0] || 0;
  let i = 0;
  for (; i < inputRange.length - 1; i++) {
    if (frame <= inputRange[i + 1]) break;
  }
  i = Math.min(i, inputRange.length - 2);
  const inputLow = inputRange[i], inputHigh = inputRange[i + 1];
  const outputLow = outputRange[i], outputHigh = outputRange[i + 1];
  let t = inputHigh === inputLow ? 0 : (frame - inputLow) / (inputHigh - inputLow);
  if (t < 0 && extrapolateLeft === 'clamp') t = 0;
  if (t > 1 && extrapolateRight === 'clamp') t = 1;
  const easing = options.easing;
  if (easing && t >= 0 && t <= 1) t = easing(t);
  return outputLow + t * (outputHigh - outputLow);
}

function spring({ frame, fps = ${fps}, config = {} }) {
  const { damping = 10, mass = 1, stiffness = 100, overshootClamping = false } = config;
  const from = config.from ?? 0, to = config.to ?? 1;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const t = frame / fps;
  let value;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    value = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
  } else {
    const s1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
    const s2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
    value = 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
  }
  if (overshootClamping) value = Math.min(Math.max(value, 0), 1);
  return from + value * (to - from);
}

const Easing = {
  linear: (t) => t,
  ease: (t) => t * t * (3 - 2 * t),
  easeIn: (t) => t * t,
  easeOut: (t) => t * (2 - t),
  easeInOut: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  bezier: (x1, y1, x2, y2) => (t) => {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    let x = t;
    for (let i = 0; i < 8; i++) {
      const xEst = ((ax * x + bx) * x + cx) * x;
      const dx = (3 * ax * x + 2 * bx) * x + cx;
      if (Math.abs(xEst - t) < 1e-6) break;
      if (dx === 0) break;
      x -= (xEst - t) / dx;
    }
    return ((ay * x + by) * x + cy) * x;
  },
};

function Sequence({ from = 0, durationInFrames = Infinity, children }) {
  const parentFrame = useCurrentFrame();
  const relativeFrame = parentFrame - from;
  if (relativeFrame < 0 || relativeFrame >= durationInFrames) return null;
  return React.createElement(FrameContext.Provider,
    { value: { frame: relativeFrame, fps: _fps } }, children);
}

// --- Scene compilation ---
const scenes = ${JSON.stringify(scenes)};
const compiledScenes = [];

for (const scene of scenes) {
  try {
    const cleaned = scene.code
      .replace(/^\\s*export\\s+default\\s+/gm, '')
      .replace(/^\\s*export\\s+/gm, '')
      .replace(/^\\s*import\\s+.*?;?\\s*$/gm, '');
    const transpiled = Sucrase.transform(cleaned, {
      transforms: ['jsx', 'typescript'],
      jsxRuntime: 'classic',
      production: true,
    }).code;
    const factory = new Function(
      'React', 'useState', 'useEffect', 'useMemo', 'useCallback',
      'AbsoluteFill', 'Sequence', 'useCurrentFrame', 'useVideoConfig',
      'interpolate', 'spring', 'Easing',
      transpiled + '\\nreturn Main;'
    );
    const Component = factory(
      React, React.useState, React.useEffect, React.useMemo, React.useCallback,
      AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig,
      interpolate, spring, Easing
    );
    compiledScenes.push({ ...scene, Component });
  } catch (err) {
    console.error('Failed to compile scene ' + scene.sceneId + ':', err);
  }
}

// --- Render API for Puppeteer ---
const root = ReactDOM.createRoot(document.getElementById('root'));

// Cross-dissolve duration in seconds — must match CROSSFADE_MS in animation-overlay.tsx
const CROSSFADE_DURATION = 0.4;

window.__renderFrame = function(time) {
  const currentScene = compiledScenes.find(s => time >= s.startTime && time < s.endTime);
  const outgoingScene = compiledScenes.find(
    s => s.endTime <= time && time < s.endTime + CROSSFADE_DURATION
  );

  if (!currentScene && !outgoingScene) {
    root.render(null);
    return false;
  }

  const elements = [];

  if (outgoingScene) {
    // Use the last valid frame of the outgoing scene
    const lastFrame = Math.max(
      0,
      Math.ceil((outgoingScene.endTime - outgoingScene.startTime) * _fps) - 1
    );
    // If there's a current scene, draw outgoing at full opacity (current will cover it
    // progressively via source-over). If no current scene, fade to transparent.
    const outOpacity = currentScene
      ? 1
      : 1 - Math.min(1, (time - outgoingScene.endTime) / CROSSFADE_DURATION);

    elements.push(
      React.createElement('div', {
        key: 'out',
        style: { position: 'absolute', inset: 0, opacity: outOpacity }
      },
        React.createElement(FrameContext.Provider,
          { value: { frame: lastFrame, fps: _fps } },
          React.createElement(outgoingScene.Component, { scene: outgoingScene.direction })
        )
      )
    );
  }

  if (currentScene) {
    const frame = Math.floor((time - currentScene.startTime) * _fps);
    // Fade in over outgoing — source-over: result = incoming*t + outgoing*(1-t)
    const inOpacity = outgoingScene
      ? Math.min(1, (time - outgoingScene.endTime) / CROSSFADE_DURATION)
      : 1;

    elements.push(
      React.createElement('div', {
        key: 'in',
        style: { position: 'absolute', inset: 0, opacity: inOpacity }
      },
        React.createElement(FrameContext.Provider,
          { value: { frame, fps: _fps } },
          React.createElement(currentScene.Component, { scene: currentScene.direction })
        )
      )
    );
  }

  return new Promise((resolve) => {
    ReactDOM.flushSync(() => {
      root.render(
        React.createElement('div', {
          style: { position: 'relative', width: '100%', height: '100%' }
        }, ...elements)
      );
    });
    requestAnimationFrame(() => resolve(true));
  });
};

window.__ready = true;
`;
}

/**
 * Find a package's dist file in node_modules, checking both local and hoisted locations.
 */
function findNodeModuleFile(relativePath: string): string {
	const candidates = [
		path.resolve(process.cwd(), "node_modules", relativePath),
		path.resolve(process.cwd(), "../../node_modules", relativePath),
	];
	// Also check bun's .bun directory structure
	const parts = relativePath.split("/");
	const pkgName = parts[0];
	const restPath = parts.slice(1).join("/");
	const bunDir = path.resolve(process.cwd(), "../../node_modules/.bun");
	if (fs.existsSync(bunDir)) {
		try {
			const entries = fs.readdirSync(bunDir);
			for (const entry of entries) {
				if (entry.startsWith(`${pkgName}@`)) {
					candidates.push(
						path.resolve(bunDir, entry, "node_modules", pkgName, restPath),
					);
				}
			}
		} catch { /* ignore */ }
	}
	for (const c of candidates) {
		if (fs.existsSync(c)) return c;
	}
	throw new Error(`Could not find ${relativePath} in node_modules`);
}

/**
 * Bundle Sucrase into a single browser-compatible IIFE using esbuild.
 * Sucrase's dist is CJS with internal require() calls, so we need to
 * bundle it into a single file that exposes window.Sucrase.
 * Result is cached in /tmp for reuse across exports.
 */
let _sucraseBundleCache: string | null = null;
async function getSucraseBrowserBundle(): Promise<string> {
	if (_sucraseBundleCache) return _sucraseBundleCache;

	const cachePath = path.join(os.tmpdir(), "opencut-sucrase-bundle.js");
	if (fs.existsSync(cachePath)) {
		_sucraseBundleCache = fs.readFileSync(cachePath, "utf-8");
		return _sucraseBundleCache;
	}

	const sucrasePath = findNodeModuleFile("sucrase/dist/index.js");
	const esbuild = await import("esbuild");
	const result = await esbuild.build({
		entryPoints: [sucrasePath],
		bundle: true,
		format: "iife",
		globalName: "Sucrase",
		platform: "browser",
		write: false,
		minify: true,
	});

	const code = result.outputFiles[0].text;
	fs.writeFileSync(cachePath, code);
	_sucraseBundleCache = code;
	return code;
}

/**
 * Build a self-contained HTML page that loads React 19 + ReactDOM from CDN,
 * Sucrase from a local file, and sets up the animation render API.
 *
 * React 19 dropped UMD builds, so we use esm.sh's UMD-compatible bundles
 * which expose React/ReactDOM as globals. Sucrase's dist/index.js already
 * exposes a global `Sucrase` object.
 */
function buildAnimationPage({
	width,
	height,
}: {
	width: number;
	height: number;
}): string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: transparent; }
  #root { width: ${width}px; height: ${height}px; position: relative; }
</style>
</head>
<body>
<div id="root"></div>
<script>
// CJS require/module shim for React 19 CJS bundles
var __modules = {};
var __moduleCache = {};
function require(name) {
  if (__moduleCache[name]) return __moduleCache[name].exports;
  var mod = __modules[name];
  if (!mod) throw new Error('Module not found: ' + name);
  var module = { exports: {} };
  __moduleCache[name] = module;
  mod(module, module.exports, require);
  return module.exports;
}
function __define(name, factory) {
  __modules[name] = factory;
}
</script>
<!-- React 19 loaded via inline CJS shim below -->
<script id="animation-init">
// Placeholder — React/ReactDOM/Sucrase will be injected by Puppeteer
// via page.evaluate() after loading CJS files
</script>
</body>
</html>`;
}

/**
 * Read a CJS file and wrap it as a module definition for the in-browser require shim.
 */
function wrapCJSModule(name: string, filePath: string): string {
	const code = fs.readFileSync(filePath, "utf-8");
	// Wrap in a module factory: function(module, exports, require) { ... }
	return `__define(${JSON.stringify(name)}, function(module, exports, require) {\n${code}\n});`;
}

/**
 * Render animation frames using Puppeteer and save as transparent PNGs.
 *
 * Loads React 19 CJS files via an in-browser require shim (since React 19
 * dropped UMD builds), then compiles and renders each animation scene
 * frame-by-frame.
 */
async function renderAnimationFrames({
	scenes,
	width,
	height,
	fps,
	duration,
	onProgress,
}: {
	scenes: AnimationScene[];
	width: number;
	height: number;
	fps: number;
	duration: number;
	onProgress?: (progress: number) => void;
}): Promise<string> {
	const puppeteer = await import("puppeteer");

	const framesDir = path.join(os.tmpdir(), `opencut-frames-${Date.now()}`);
	fs.mkdirSync(framesDir, { recursive: true });

	// Resolve CJS file paths
	const reactPath = findNodeModuleFile("react/cjs/react.production.js");
	const reactDomPath = findNodeModuleFile("react-dom/cjs/react-dom.production.js");
	const reactDomClientPath = findNodeModuleFile("react-dom/cjs/react-dom-client.production.js");
	const sucraseBundle = await getSucraseBrowserBundle();

	// React-dom-client requires "scheduler" — provide a minimal shim
	const schedulerShim = `
__define("scheduler", function(module, exports) {
  var _queue = [];
  var _scheduled = false;
  function _flush() {
    _scheduled = false;
    var q = _queue.slice();
    _queue.length = 0;
    for (var i = 0; i < q.length; i++) q[i]();
  }
  exports.unstable_scheduleCallback = function(priority, callback) {
    _queue.push(callback);
    if (!_scheduled) { _scheduled = true; setTimeout(_flush, 0); }
    return { id: _queue.length };
  };
  exports.unstable_cancelCallback = function(task) {};
  exports.unstable_shouldYield = function() { return false; };
  exports.unstable_requestPaint = function() {};
  exports.unstable_now = function() { return performance.now(); };
  exports.unstable_getCurrentPriorityLevel = function() { return 3; };
  exports.unstable_ImmediatePriority = 1;
  exports.unstable_UserBlockingPriority = 2;
  exports.unstable_NormalPriority = 3;
  exports.unstable_LowPriority = 4;
  exports.unstable_IdlePriority = 5;
  exports.unstable_runWithPriority = function(priority, fn) { return fn(); };
  exports.unstable_next = function(fn) { return fn(); };
  exports.unstable_wrapCallback = function(fn) { return fn; };
  exports.unstable_forceFrameRate = function() {};
  exports.unstable_Profiling = null;
});`;

	// Build the CJS bundle to inject
	const reactModule = wrapCJSModule("react", reactPath);
	const reactDomModule = wrapCJSModule("react-dom", reactDomPath);
	const reactDomClientModule = wrapCJSModule("react-dom/client", reactDomClientPath);

	const html = buildAnimationPage({ width, height });

	const chromiumPath = process.env.CHROMIUM_PATH || undefined;
	const browser = await puppeteer.default.launch({
		headless: true,
		...(chromiumPath ? { executablePath: chromiumPath } : {}),
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-dev-shm-usage",
			"--disable-gpu",
			"--disable-software-rasterizer",
			`--window-size=${width},${height}`,
		],
	});

	try {
		const page = await browser.newPage();
		await page.setViewport({ width, height, deviceScaleFactor: 1 });

		// Capture console errors for debugging
		const pageErrors: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "error") pageErrors.push(msg.text());
		});
		page.on("pageerror", (err: unknown) => pageErrors.push(err instanceof Error ? err.message : String(err)));

		// Load the base HTML
		await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 10000 });

		// Inject the CJS require shim modules
		await page.evaluate(schedulerShim);
		await page.evaluate(reactModule);
		await page.evaluate(reactDomModule);
		await page.evaluate(reactDomClientModule);

		// Expose React and ReactDOM as globals
		// createRoot is on react-dom/client, flushSync is on react-dom base
		await page.evaluate(`
			var React = require("react");
			var ReactDOMBase = require("react-dom");
			var ReactDOMClient = require("react-dom/client");
			var ReactDOM = Object.assign({}, ReactDOMBase, ReactDOMClient);
			window.React = React;
			window.ReactDOM = ReactDOM;
		`);

		// Load Sucrase (pre-bundled IIFE that exposes window.Sucrase)
		await page.evaluate(sucraseBundle);

		// Inject the animation script (compiles scenes, sets up __renderFrame)
		const animScript = generateAnimationScript({ scenes, width, height, fps });
		await page.evaluate(animScript);

		// Wait for the page to be ready
		try {
			await page.waitForFunction("window.__ready === true", { timeout: 10000 });
		} catch {
			const errorSummary = pageErrors.length > 0
				? pageErrors.slice(0, 5).join("\n")
				: "No console errors captured";
			throw new Error(
				`Animation page failed to initialize.\nPage errors:\n${errorSummary}`,
			);
		}

		const totalFrames = Math.ceil(duration * fps);

		for (let i = 0; i < totalFrames; i++) {
			const time = i / fps;

			// Include the crossfade tail (0.4s after each scene ends) so outgoing scenes
		// can fade out smoothly rather than cutting off at the exact boundary frame.
		const hasScene = scenes.some(
				(s) => time >= s.startTime && time < s.endTime + 0.4,
			);

			if (hasScene) {
				const rendered = await page.evaluate(async (t: number) => {
					return await (window as any).__renderFrame(t);
				}, time);

				if (rendered) {
					await page.evaluate(
						() => new Promise((r) => requestAnimationFrame(r)),
					);
				}
			} else {
				// Clear any previous animation content for non-animation frames
				await page.evaluate(() => {
					const root = document.getElementById("root");
					if (root) root.innerHTML = "";
				});
			}

			const framePath = path.join(framesDir, `frame_${String(i).padStart(6, "0")}.png`);

			// Always screenshot from Puppeteer — omitBackground:true produces
			// correct transparent PNGs at full resolution (no 1x1 scaling artifacts)
			await page.screenshot({
				path: framePath,
				type: "png",
				omitBackground: true,
				clip: { x: 0, y: 0, width, height },
			});

			if (onProgress && i % 10 === 0) {
				onProgress(i / totalFrames);
			}
		}
	} finally {
		await browser.close();
	}

	return framesDir;
}

/**
 * Probe the audio stream start_time of a media file using ffprobe.
 *
 * Many raw recordings (webcam, OBS, phone) have an audio stream that starts
 * slightly after the video stream (positive start_time). The Web Audio API
 * normalizes this away when decoding, so preview playback is fine. But FFmpeg
 * trim/atrim filters use container timestamps, so we need to compensate.
 *
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

/**
 * Build a base video from raw uploaded segments by trimming with ffmpeg.
 *
 * IMPORTANT: The editor's trimStart values are in "decoded buffer time" where
 * audio sample 0 = first real audio content. But raw recordings often have
 * audio that starts later than video (e.g. 0.334s). The Web Audio API strips
 * this delay when decoding, so the editor's trimStart=5.0 means "5s into the
 * decoded content" which is actually at container time 5.334s. We detect this
 * offset via ffprobe and add it to trimStart so FFmpeg grabs the right portion.
 */
async function buildBaseFromSegments({
	segments,
	outputPath,
}: {
	segments: MainVideoSegmentData[];
	outputPath: string;
}): Promise<void> {
	const sorted = [...segments]
		.filter((s) => s.duration >= 0.01)
		.sort((a, b) => a.timelineStart - b.timelineStart);

	if (sorted.length === 0) {
		throw new Error("All segments have near-zero duration — nothing to encode.");
	}

	// Probe each unique file for audio start_time offset.
	const audioOffsetCache = new Map<string, number>();
	for (const seg of sorted) {
		if (!audioOffsetCache.has(seg.serverPath)) {
			const offset = await probeAudioStartTime(seg.serverPath);
			audioOffsetCache.set(seg.serverPath, offset);
			if (offset > 0) {
				console.log(`[buildBaseFromSegments] Audio offset: ${offset}s for ${seg.serverPath}`);
			}
		}
	}

	const args: string[] = ["-y"];

	for (const seg of sorted) {
		const audioOffset = audioOffsetCache.get(seg.serverPath) ?? 0;
		// Shift trimStart by audio offset to convert from decoded-buffer-time
		// to container-time. This ensures FFmpeg grabs the same content the
		// editor preview shows.
		const containerTrimStart = seg.trimStart + audioOffset;
		args.push("-ss", String(containerTrimStart), "-t", String(seg.duration), "-i", seg.serverPath);
	}

	if (sorted.length === 1) {
		args.push(
			"-c:v", "libx264",
			"-preset", "fast",
			"-crf", "18",
			"-pix_fmt", "yuv420p",
			"-c:a", "aac",
			"-b:a", "192k",
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
			"-map", "[outv]",
			"-map", "[outa]",
			"-c:v", "libx264",
			"-preset", "fast",
			"-crf", "18",
			"-pix_fmt", "yuv420p",
			"-c:a", "aac",
			"-b:a", "192k",
			outputPath,
		);
	}

	return new Promise((resolve, reject) => {
		const ff = spawn("ffmpeg", args);
		let stderr = "";
		ff.stderr.on("data", (d) => { stderr += d.toString(); });
		ff.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg buildBase exited ${code}: ${stderr.slice(-500)}`));
		});
		ff.on("error", reject);
	});
}

/**
 * Composite base video + animation overlay + PiP video + audio using ffmpeg.
 *
 * PiP video clips are overlaid in the bottom-left corner with a yellow border,
 * matching the preview's AnimationOverlay PiP styling.
 */
function compositeWithFFmpeg({
	baseVideoPath,
	animationFramesDir,
	audioPath,
	videoClips,
	outputPath,
	fps,
	width,
	height,
	format,
	quality,
	duration,
}: {
	baseVideoPath: string;
	animationFramesDir: string;
	audioPath?: string;
	videoClips?: VideoClipData[];
	outputPath: string;
	fps: number;
	width: number;
	height: number;
	format: string;
	quality: string;
	duration: number;
}): Promise<void> {
	return new Promise((resolve, reject) => {
		const args: string[] = [
			"-y",
			// Input 0: base video
			"-i", baseVideoPath,
			// Input 1: animation frames as image sequence
			"-framerate", String(fps),
			"-i", path.join(animationFramesDir, "frame_%06d.png"),
		];

		// Input 2+: PiP video clips (if any)
		const pipInputs: { index: number; clip: VideoClipData }[] = [];
		let nextInputIdx = 2;

		if (videoClips && videoClips.length > 0) {
			for (const clip of videoClips) {
				if (fs.existsSync(clip.serverPath)) {
					// Load full input — trimming is handled in the filter graph
					// to avoid keyframe-snap and audio offset issues.
					args.push("-i", clip.serverPath);
					pipInputs.push({ index: nextInputIdx, clip });
					nextInputIdx++;
				}
			}
		}

		// Audio input
		const audioInputIdx = nextInputIdx;
		if (audioPath && fs.existsSync(audioPath)) {
			args.push("-i", audioPath);
			nextInputIdx++;
		}

		// Build filter chain
		// PiP dimensions matching preview: 440x580, positioned at bottom:150 left:40
		// with 5px yellow border
		const pipW = 440;
		const pipH = 580;
		const pipX = 40;
		const pipY = height - 150 - pipH; // bottom:150 means Y = height - 150 - pipH
		const borderSize = 5;

		const filterParts: string[] = [];
		let currentBase = "[0:v]";

		// Step 1: Overlay animation frames on base video
		filterParts.push(`${currentBase}[1:v]overlay=0:0:format=auto:shortest=1[anim_out]`);
		currentBase = "[anim_out]";

		// Step 2: Overlay PiP video clips (if any)
		// Strategy: concatenate ALL PiP clips into a single continuous stream,
		// apply rounded corners + yellow border ONCE, then overlay ONCE.
		// This eliminates 1-frame gaps at split points that caused yellow blinks.
		if (pipInputs.length > 0) {
			const borderRadius = 24;
			const innerW = pipW - borderSize * 2;
			const innerH = pipH - borderSize * 2;
			const innerR = Math.max(0, borderRadius - borderSize);

			// Sort clips by startTime to ensure correct concat order
			const sortedPips = [...pipInputs].sort((a, b) => a.clip.startTime - b.clip.startTime);

			// Scale + crop each clip to the same inner size for concat compatibility
			// Use lanczos scaling for sharper downscale quality
			// Also apply trim here since we no longer use -ss/-t on input
			for (let i = 0; i < sortedPips.length; i++) {
				const { index, clip } = sortedPips[i];
				const trimEnd = clip.trimStart + clip.duration;
				filterParts.push(
					`[${index}:v]trim=start=${clip.trimStart}:end=${trimEnd},setpts=PTS-STARTPTS,` +
					`scale=${innerW}:${innerH}:force_original_aspect_ratio=increase:flags=lanczos,` +
					`crop=${innerW}:${innerH}` +
					`[pip_scaled_${i}]`,
				);
			}

			// Concatenate all clips into one continuous stream
			let concatInput = "";
			for (let i = 0; i < sortedPips.length; i++) {
				concatInput += `[pip_scaled_${i}]`;
			}
			filterParts.push(
				`${concatInput}concat=n=${sortedPips.length}:v=1:a=0[pip_concat]`,
			);

			// Apply rounded corners on the concatenated stream
			filterParts.push(
				`[pip_concat]format=yuva420p,` +
				`geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':` +
				`a='if(gt(abs(W/2-X),W/2-${innerR})*gt(abs(H/2-Y),H/2-${innerR}),` +
				`if(lte(hypot(abs(W/2-X)-(W/2-${innerR}),abs(H/2-Y)-(H/2-${innerR})),${innerR}),255,0),255)'` +
				`[pip_rounded]`,
			);

			// Create yellow border background with rounded corners (single instance)
			filterParts.push(
				`color=c=#F5C518:s=${pipW}x${pipH}:d=${duration},` +
				`format=yuva420p,` +
				`geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':` +
				`a='if(gt(abs(W/2-X),W/2-${borderRadius})*gt(abs(H/2-Y),H/2-${borderRadius}),` +
				`if(lte(hypot(abs(W/2-X)-(W/2-${borderRadius}),abs(H/2-Y)-(H/2-${borderRadius})),${borderRadius}),255,0),255)'` +
				`[pip_border]`,
			);

			// Overlay rounded inner video on yellow border
			filterParts.push(
				`[pip_border][pip_rounded]overlay=${borderSize}:${borderSize}:format=auto:eof_action=pass` +
				`[pip_combined]`,
			);

			// Shift PTS so the PiP stream starts at the first clip's startTime
			const firstClipStart = sortedPips[0].clip.startTime;
			filterParts.push(
				`[pip_combined]setpts=PTS-STARTPTS+${firstClipStart}/TB[pip_final]`,
			);

			// Single overlay of the entire PiP stream onto the base
			filterParts.push(
				`${currentBase}[pip_final]overlay=${pipX}:${pipY}:eof_action=pass[pip_out]`,
			);
			currentBase = "[pip_out]";
		}

		// Rename final output
		if (currentBase !== "[out]") {
			// Just use the last label as output
			const lastFilter = filterParts[filterParts.length - 1];
			filterParts[filterParts.length - 1] = lastFilter.replace(
				/\[[^\]]+\]$/,
				"[out]",
			);
		}

		args.push("-filter_complex", filterParts.join(";"));
		args.push("-map", "[out]");

		// Map audio if present
		if (audioPath && fs.existsSync(audioPath)) {
			args.push("-map", `${audioInputIdx}:a?`);
		} else {
			args.push("-map", "0:a?");
		}

		// Output settings
		if (format === "webm") {
			const bitrate = QUALITY_BITRATE_WEBM[quality] || "10M";
			args.push("-c:v", "libvpx-vp9", "-b:v", bitrate, "-c:a", "libopus");
		} else {
			const crf = QUALITY_CRF[quality] ?? 18;
			const preset = QUALITY_PRESET[quality] || "medium";
			args.push(
				"-c:v", "libx264",
				"-preset", preset,
				"-crf", String(crf),
				"-pix_fmt", "yuv420p",
				"-c:a", "aac",
				"-b:a", "192k",
			);
		}

		args.push("-t", String(duration), outputPath);

		const ffmpeg = spawn("ffmpeg", args);

		let stderr = "";
		ffmpeg.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		ffmpeg.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
			}
		});

		ffmpeg.on("error", (err) => {
			reject(new Error(`ffmpeg spawn error: ${err.message}`));
		});
	});
}

/**
 * Composite without animation overlay — just re-encode the base video
 * with optional audio using ffmpeg for consistent output.
 */
function encodeBaseOnly({
	baseVideoPath,
	audioPath,
	outputPath,
	format,
	quality,
	duration,
}: {
	baseVideoPath: string;
	audioPath?: string;
	outputPath: string;
	format: string;
	quality: string;
	duration: number;
}): Promise<void> {
	return new Promise((resolve, reject) => {
		const args: string[] = ["-y", "-i", baseVideoPath];

		if (audioPath && fs.existsSync(audioPath)) {
			args.push("-i", audioPath);
			args.push("-map", "0:v", "-map", "1:a?");
		}

		if (format === "webm") {
			const bitrate = QUALITY_BITRATE_WEBM[quality] || "10M";
			args.push("-c:v", "libvpx-vp9", "-b:v", bitrate, "-c:a", "libopus");
		} else {
			const crf = QUALITY_CRF[quality] ?? 18;
			const preset = QUALITY_PRESET[quality] || "medium";
			args.push(
				"-c:v", "libx264",
				"-preset", preset,
				"-crf", String(crf),
				"-pix_fmt", "yuv420p",
				"-c:a", "aac",
				"-b:a", "192k",
			);
		}

		args.push("-t", String(duration), outputPath);

		const ffmpeg = spawn("ffmpeg", args);
		let stderr = "";
		ffmpeg.stderr.on("data", (d) => { stderr += d.toString(); });
		ffmpeg.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
		});
		ffmpeg.on("error", (err) => reject(err));
	});
}

/**
 * Encode a Puppeteer PNG frame sequence into a standalone video.
 * Used for animation-only export (no base video, transparent frames on black).
 */
function encodeAnimationOnly({
	framesDir,
	outputPath,
	fps,
	duration,
	format,
	quality,
}: {
	framesDir: string;
	outputPath: string;
	fps: number;
	duration: number;
	format: string;
	quality: string;
}): Promise<void> {
	return new Promise((resolve, reject) => {
		const args: string[] = [
			"-y",
			"-framerate", String(fps),
			"-i", path.join(framesDir, "frame_%06d.png"),
		];

		if (format === "webm") {
			const bitrate = QUALITY_BITRATE_WEBM[quality] || "10M";
			args.push("-c:v", "libvpx-vp9", "-b:v", bitrate, "-pix_fmt", "yuva420p");
		} else {
			const crf = QUALITY_CRF[quality] ?? 18;
			const preset = QUALITY_PRESET[quality] || "medium";
			args.push(
				"-c:v", "libx264",
				"-preset", preset,
				"-crf", String(crf),
				"-pix_fmt", "yuv420p",
			);
		}

		args.push("-t", String(duration), outputPath);

		const ffmpeg = spawn("ffmpeg", args);
		let stderr = "";
		ffmpeg.stderr.on("data", (d) => { stderr += d.toString(); });
		ffmpeg.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg encodeAnimationOnly exited ${code}: ${stderr.slice(-500)}`));
		});
		ffmpeg.on("error", reject);
	});
}

export async function POST(request: NextRequest) {
	const tmpDir = path.join(os.tmpdir(), `opencut-export-${Date.now()}`);
	fs.mkdirSync(tmpDir, { recursive: true });

	try {
		const body: ExportRequest = await request.json();
		const {
			animationScenes = [],
			fps = 30,
			duration,
			width = 1080,
			height = 1920,
			baseVideoPath: rawBaseVideoPath,
			mainVideoSegments,
			format = "mp4",
			quality = "high",
			includeAudio = true,
			audioPath,
			videoClips = [],
			animationOnly = false,
			faceVideoOnly = false,
			faceVideoSegments = [],
		} = body;

		if (!duration) {
			return NextResponse.json({ error: "Missing duration" }, { status: 400 });
		}

		if (!animationOnly && !faceVideoOnly) {
			const hasVideoSource = rawBaseVideoPath || (mainVideoSegments && mainVideoSegments.length > 0);
			if (!hasVideoSource) {
				return NextResponse.json(
					{ error: "Missing video source (baseVideoPath or mainVideoSegments)" },
					{ status: 400 },
				);
			}
		}

		const ext = format === "webm" ? ".webm" : ".mp4";
		const outputPath = path.join(tmpDir, `output${ext}`);

		const hasAnimations = animationScenes.length > 0;

		// Stream progress via SSE-style response, then binary data
		const stream = new ReadableStream({
			async start(controller) {
				try {
					// Animation-only export: render frames and encode directly
					if (animationOnly) {
						if (!hasAnimations) {
							throw new Error("No animation scenes provided for animation-only export");
						}
						sendSSE(controller, { type: "progress", progress: 0.05, stage: "Rendering animation frames..." });
						const framesDir = await renderAnimationFrames({
							scenes: animationScenes,
							width,
							height,
							fps,
							duration,
							onProgress: (p) => {
								sendSSE(controller, { type: "progress", progress: 0.05 + p * 0.8, stage: "Rendering animation frames..." });
							},
						});
						sendSSE(controller, { type: "progress", progress: 0.87, stage: "Encoding video..." });
						await encodeAnimationOnly({ framesDir, outputPath, fps, duration, format, quality });
						sendSSE(controller, { type: "progress", progress: 0.97, stage: "Finalizing..." });
						const fileBuffer = fs.readFileSync(outputPath);
						sendSSE(controller, { type: "complete" });
						const encoder = new TextEncoder();
						controller.enqueue(encoder.encode("\n---BINARY_START---\n"));
						const CHUNK_SIZE = 64 * 1024;
						for (let i = 0; i < fileBuffer.length; i += CHUNK_SIZE) {
							const chunkSize = Math.min(CHUNK_SIZE, fileBuffer.length - i);
							controller.enqueue(new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset + i, chunkSize));
						}
						controller.close();
						return;
					}

					// Face-video-only export: trim + concatenate face cam clips with FFmpeg (stream copy)
					if (faceVideoOnly) {
						if (!faceVideoSegments.length) {
							throw new Error("No face video segments provided");
						}
						sendSSE(controller, { type: "progress", progress: 0.1, stage: "Assembling face video clips..." });
						await buildBaseFromSegments({ segments: faceVideoSegments, outputPath });
						sendSSE(controller, { type: "progress", progress: 0.9, stage: "Finalizing..." });
						const faceBuffer = fs.readFileSync(outputPath);
						sendSSE(controller, { type: "complete" });
						const faceEnc = new TextEncoder();
						controller.enqueue(faceEnc.encode("\n---BINARY_START---\n"));
						const FACE_CHUNK = 64 * 1024;
						for (let i = 0; i < faceBuffer.length; i += FACE_CHUNK) {
							const sz = Math.min(FACE_CHUNK, faceBuffer.length - i);
							controller.enqueue(new Uint8Array(faceBuffer.buffer, faceBuffer.byteOffset + i, sz));
						}
						controller.close();
						return;
					}

					// Resolve baseVideoPath — either pre-rendered or built from raw segments
					let baseVideoPath = rawBaseVideoPath;
					if (!baseVideoPath && mainVideoSegments && mainVideoSegments.length > 0) {
						sendSSE(controller, {
							type: "progress",
							progress: 0.03,
							stage: "Preparing base video from raw segments...",
						});
						const segmentsBasePath = path.join(tmpDir, "base-from-segments.mp4");
						await buildBaseFromSegments({
							segments: mainVideoSegments,
							outputPath: segmentsBasePath,
						});
						baseVideoPath = segmentsBasePath;
					}

					if (!baseVideoPath) {
						throw new Error("No base video available");
					}

					let animationFramesDir: string | undefined;

					if (hasAnimations) {
						sendSSE(controller, {
							type: "progress",
							progress: 0.1,
							stage: "Rendering animation frames...",
						});

						animationFramesDir = await renderAnimationFrames({
							scenes: animationScenes,
							width,
							height,
							fps,
							duration,
							onProgress: (p) => {
								sendSSE(controller, {
									type: "progress",
									progress: 0.1 + p * 0.5,
									stage: "Rendering animation frames...",
								});
							},
						});

						sendSSE(controller, {
							type: "progress",
							progress: 0.65,
							stage: "Compositing with ffmpeg...",
						});

						await compositeWithFFmpeg({
							baseVideoPath,
							animationFramesDir,
							audioPath: includeAudio ? audioPath : undefined,
							videoClips: videoClips.length > 0 ? videoClips : undefined,
							outputPath,
							fps,
							width,
							height,
							format,
							quality,
							duration,
						});
					} else {
						sendSSE(controller, {
							type: "progress",
							progress: 0.5,
							stage: "Encoding video...",
						});

						await encodeBaseOnly({
							baseVideoPath,
							audioPath: includeAudio ? audioPath : undefined,
							outputPath,
							format,
							quality,
							duration,
						});
					}

					sendSSE(controller, {
						type: "progress",
						progress: 0.9,
						stage: "Finalizing...",
					});

					// Read the output file and stream it
					const fileBuffer = fs.readFileSync(outputPath);

					sendSSE(controller, { type: "complete" });

					// Send binary boundary marker
					const encoder = new TextEncoder();
					controller.enqueue(encoder.encode("\n---BINARY_START---\n"));

					// Send the file in chunks
					const CHUNK_SIZE = 64 * 1024;
					for (let i = 0; i < fileBuffer.length; i += CHUNK_SIZE) {
						const chunkSize = Math.min(CHUNK_SIZE, fileBuffer.length - i);
						// Copy to a new Uint8Array to avoid Buffer byteOffset issues
						const chunk = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset + i, chunkSize);
						controller.enqueue(new Uint8Array(chunk));
					}

					controller.close();
				} catch (err) {
					console.error("[export-video] Error:", err);
					sendSSE(controller, {
						type: "error",
						error: err instanceof Error ? err.message : "Export failed",
					});
					controller.close();
				} finally {
					// Cleanup temp files
					cleanup(tmpDir);
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
		cleanup(tmpDir);
		console.error("[export-video] Failed:", error);
		const message = error instanceof Error ? error.message : "Unknown error";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}

function cleanup(dir: string) {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors
	}
}
