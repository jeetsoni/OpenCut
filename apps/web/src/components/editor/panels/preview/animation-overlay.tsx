/**
 * Animation overlay for the main editor preview.
 *
 * Subscribes to the scene store for compiled animations.
 * Renders the active scene's animation on top of the canvas,
 * synced to the editor's playback clock.
 * Includes a PiP face cam (muted — audio comes from the main canvas).
 *
 * Performance: Uses requestAnimationFrame to update frame numbers
 * instead of triggering React re-renders on every playback tick.
 */

"use client";

import { useState, useEffect, useMemo, useRef, useCallback, Component as ReactComponent } from "react";
import type React from "react";
import { EditorCore } from "@/core";
import { useEditor } from "@/hooks/use-editor";
import { useSceneStore } from "@/stores/scene-store";
import { getSceneRemotionCode } from "@/lib/remotion-renderer/scene-code-store";
import type {
	CompileResult,
	CompileError,
} from "@/lib/remotion-renderer/compile";
import type { PlannedScene } from "@/lib/scene-planner/schema";
import type { VideoElement } from "@/types/timeline";

// Lazy-loaded compile module (pulls in remotion + sucrase)
let _compileModule: typeof import("@/lib/remotion-renderer/compile") | null = null;
async function getCompileModule() {
	if (!_compileModule) {
		_compileModule = await import("@/lib/remotion-renderer/compile");
	}
	return _compileModule;
}

interface VideoClip {
	src: string;
	startTime: number;
	duration: number;
	trimStart: number;
}

const COMP_WIDTH = 1080;
const COMP_HEIGHT = 1920;
const CROSSFADE_MS = 400; // duration of scene cross-dissolve in ms

/**
 * Wraps a scene with a CSS opacity fade on mount.
 * direction="in"  → mounts transparent, fades to opaque
 * direction="out" → mounts opaque, fades to transparent, then calls onFaded
 */
function FadeWrapper({
	children,
	direction,
	onFaded,
}: {
	children: React.ReactNode;
	direction: "in" | "out";
	onFaded?: () => void;
}) {
	const [opacity, setOpacity] = useState(direction === "in" ? 0 : 1);
	const onFadedRef = useRef(onFaded);
	onFadedRef.current = onFaded;

	useEffect(() => {
		// Commit the initial opacity to the DOM first, then trigger the CSS transition
		const raf = requestAnimationFrame(() => setOpacity(direction === "in" ? 1 : 0));
		return () => cancelAnimationFrame(raf);
	}, [direction]);

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				opacity,
				transition: `opacity ${CROSSFADE_MS}ms ease-in-out`,
				pointerEvents: direction === "out" ? "none" : "auto",
			}}
			onTransitionEnd={() => {
				if (direction === "out") onFadedRef.current?.();
			}}
		>
			{children}
		</div>
	);
}

interface CompiledScene {
	sceneId: number;
	startTime: number;
	endTime: number;
	Component: React.FC<{ scene: PlannedScene }>;
	direction: PlannedScene;
}

/**
 * Error boundary to catch runtime errors in AI-generated animation components.
 * Reports errors to the scene store so the properties panel can display them.
 */
class AnimationErrorBoundary extends ReactComponent<
	{ sceneId: number; children: React.ReactNode },
	{ hasError: boolean; error: string | null }
> {
	constructor(props: { sceneId: number; children: React.ReactNode }) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error) {
		return { hasError: true, error: error.message };
	}

	componentDidCatch(error: Error) {
		console.warn(`[AnimationOverlay] Scene ${this.props.sceneId} runtime error:`, error.message);
		useSceneStore.getState().setSceneError(this.props.sceneId, error.message);
	}

	componentDidUpdate(prevProps: { sceneId: number }) {
		if (prevProps.sceneId !== this.props.sceneId && this.state.hasError) {
			this.setState({ hasError: false, error: null });
		}
	}

	render() {
		if (this.state.hasError) return null;
		return this.props.children;
	}
}

/**
 * Inner component that drives frame updates via RAF instead of React re-renders.
 * Only re-renders when the active scene changes (structural change),
 * not on every playback tick.
 */
function AnimationRenderer({
	scene,
	videoClips,
	fps,
	showPip = true,
}: {
	scene: CompiledScene;
	videoClips: VideoClip[];
	fps: number;
	showPip?: boolean;
}) {
	const { Component, direction, sceneId, startTime } = scene;
	const [frameState, setFrameState] = useState({ frame: 0, currentTime: 0, isPlaying: false });
	const [EditorFrameContext, setEditorFrameContext] = useState<React.Context<{ frame: number; fps: number }> | null>(null);
	const rafRef = useRef<number>(0);
	const lastFrameRef = useRef(-1);

	useEffect(() => {
		getCompileModule().then((mod) => setEditorFrameContext(mod.EditorFrameContext));
	}, []);

	useEffect(() => {
		const editor = EditorCore.getInstance();

		function tick() {
			const time = editor.playback.getCurrentTime();
			const playing = editor.playback.getIsPlaying();
			const frame = Math.floor((time - startTime) * fps);

			// Only trigger React re-render when the frame actually changes
			if (frame !== lastFrameRef.current) {
				lastFrameRef.current = frame;
				setFrameState({ frame, currentTime: time, isPlaying: playing });
			}

			rafRef.current = requestAnimationFrame(tick);
		}

		rafRef.current = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafRef.current);
	}, [startTime, fps]);

	const frameContextValue = useMemo(
		() => ({ frame: frameState.frame, fps }),
		[frameState.frame, fps],
	);

	const hasClips = videoClips.length > 0;

	if (!EditorFrameContext) return null;

	return (
		<>
			<EditorFrameContext.Provider value={frameContextValue}>
				<AnimationErrorBoundary sceneId={sceneId}>
					<Component scene={direction} />
				</AnimationErrorBoundary>
			</EditorFrameContext.Provider>

			{showPip && hasClips && (
				<div
					style={{
						position: "absolute",
						bottom: 150,
						left: 40,
						width: 440,
						height: 580,
						borderRadius: 24,
						overflow: "hidden",
						border: "5px solid #F5C518",
						boxShadow: "0 0 40px rgba(245, 197, 24, 0.45)",
						backgroundColor: "#111",
						display: "flex",
						justifyContent: "center",
						alignItems: "center",
					}}
				>
					<SyncedPipVideo
						clips={videoClips}
						currentTime={frameState.currentTime}
						isPlaying={frameState.isPlaying}
					/>
				</div>
			)}
		</>
	);
}

function SyncedPipVideo({
	clips,
	currentTime,
	isPlaying,
}: {
	clips: VideoClip[];
	currentTime: number;
	isPlaying: boolean;
}) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const lastTimeRef = useRef(-1);

	const activeClip = useMemo(() => {
		return clips.find(
			(c) => currentTime >= c.startTime && currentTime < c.startTime + c.duration,
		);
	}, [clips, currentTime]);

	useEffect(() => {
		const video = videoRef.current;
		if (!video || !activeClip) {
			if (video && !video.paused) video.pause();
			return;
		}
		if (video.src !== activeClip.src) video.src = activeClip.src;
		const offsetInClip = currentTime - activeClip.startTime;
		const targetTime = activeClip.trimStart + offsetInClip;
		if (isPlaying) {
			if (Math.abs(video.currentTime - targetTime) > 0.15) video.currentTime = targetTime;
			if (video.paused) video.play().catch(() => {});
		} else {
			if (!video.paused) video.pause();
			if (Math.abs(lastTimeRef.current - currentTime) > 0.001) video.currentTime = targetTime;
		}
		lastTimeRef.current = currentTime;
	}, [currentTime, isPlaying, activeClip]);

	if (!activeClip) return null;
	return (
		<video
			ref={videoRef}
			playsInline
			preload="auto"
			muted
			style={{ width: "100%", height: "100%", objectFit: "cover" }}
		/>
	);
}

function ScaledComposition({ children }: { children: React.ReactNode }) {
	const innerRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState({ x: 1, y: 1 });

	useEffect(() => {
		const el = innerRef.current;
		const parent = el?.parentElement;
		if (!el || !parent) return;
		const update = () => {
			setScale({
				x: parent.clientWidth / COMP_WIDTH,
				y: parent.clientHeight / COMP_HEIGHT,
			});
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(parent);
		return () => ro.disconnect();
	}, []);

	return (
		<div
			ref={innerRef}
			style={{
				width: COMP_WIDTH,
				height: COMP_HEIGHT,
				transformOrigin: "top left",
				transform: `scale(${scale.x}, ${scale.y})`,
				position: "absolute",
				top: 0,
				left: 0,
			}}
		>
			{children}
		</div>
	);
}

export function AnimationOverlay() {
	const editor = useEditor();
	const activeProject = editor.project.getActive();
	const fps = activeProject?.settings.fps ?? 30;
	const tracks = editor.timeline.getTracks();
	const mediaAssets = editor.media.getAssets();
	const projectId = activeProject?.metadata.id;

	// Subscribe to scene store (structural data only)
	const boundaries = useSceneStore((s) => s.boundaries);
	const sceneStatuses = useSceneStore((s) => s.sceneStatuses);

	// Stable fingerprint — only changes when hasAnimation flags change
	const animationFingerprint = useMemo(() => {
		if (!boundaries) return "";
		return boundaries.boundaries
			.map((b) => {
				const s = sceneStatuses[b.id];
				return s?.hasAnimation ? `${b.id}:1` : `${b.id}:0`;
			})
			.join(",");
	}, [boundaries, sceneStatuses]);

	// Compile scenes — only when fingerprint changes
	const [compiledScenes, setCompiledScenes] = useState<CompiledScene[]>([]);

	useEffect(() => {
		if (!projectId || !boundaries) {
			setCompiledScenes([]);
			return;
		}

		let cancelled = false;

		async function compile() {
			const compileModule = await getCompileModule();
			const scenes: CompiledScene[] = [];

			for (const b of boundaries!.boundaries) {
				const status = sceneStatuses[b.id];
				if (!status?.hasAnimation || !status?.direction) continue;

				const codeResult = await getSceneRemotionCode({ projectId: projectId!, sceneId: b.id });
				if (!codeResult) continue;

				const compiled = compileModule.compileForEditorOverlay(codeResult.code);
				if (compiled.Component) {
					scenes.push({
						sceneId: b.id,
						startTime: b.startTime,
						endTime: b.endTime,
						Component: compiled.Component as unknown as React.FC<{ scene: PlannedScene }>,
						direction: status.direction,
					});
				} else {
					console.warn(`[AnimationOverlay] Scene ${b.id} compile failed:`, compiled.error);
					queueMicrotask(() => {
						useSceneStore.getState().setSceneError(b.id, compiled.error ?? "Unknown compile error");
					});
				}
			}

			if (!cancelled) setCompiledScenes(scenes);
		}

		compile();
		return () => { cancelled = true; };
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [projectId, animationFingerprint]);

	// Extract video clips for PiP (structural, doesn't change during playback)
	const videoClips = useMemo<VideoClip[]>(() => {
		const mediaMap = new Map(mediaAssets.map((a) => [a.id, a]));
		const clips: VideoClip[] = [];
		for (const track of tracks) {
			if (track.type !== "video") continue;
			for (const element of track.elements) {
				if (element.type !== "video") continue;
				const ve = element as VideoElement;
				const asset = mediaMap.get(ve.mediaId);
				if (!asset?.url) continue;
				clips.push({
					src: asset.url,
					startTime: ve.startTime,
					duration: ve.duration,
					trimStart: ve.trimStart,
				});
			}
		}
		return clips.sort((a, b) => a.startTime - b.startTime);
	}, [tracks, mediaAssets]);

	// Track current + previous scene for crossfade — only updates on scene boundaries
	const [sceneTransition, setSceneTransition] = useState<{
		current: CompiledScene | null;
		prev: CompiledScene | null;
	}>({ current: null, prev: null });

	const compiledScenesRef = useRef(compiledScenes);
	compiledScenesRef.current = compiledScenes;

	useEffect(() => {
		const editorInstance = EditorCore.getInstance();
		let raf = 0;
		let lastId: number | null = null;

		function check() {
			const time = editorInstance.playback.getCurrentTime();
			const scene = compiledScenesRef.current.find(
				(s) => time >= s.startTime && time < s.endTime,
			);
			const id = scene?.sceneId ?? null;
			if (id !== lastId) {
				const prevId = lastId;
				lastId = id;
				setSceneTransition({
					current: scene ?? null,
					prev: compiledScenesRef.current.find((s) => s.sceneId === prevId) ?? null,
				});
			}
			raf = requestAnimationFrame(check);
		}

		raf = requestAnimationFrame(check);
		return () => cancelAnimationFrame(raf);
	}, []);

	const { current: currentScene, prev: prevScene } = sceneTransition;
	if (!currentScene && !prevScene) return null;

	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			<ScaledComposition>
				{/* Outgoing scene — fades out, no PiP to avoid duplicate */}
				{prevScene && (
					<FadeWrapper
						direction="out"
						key={`prev-${prevScene.sceneId}`}
						onFaded={() => setSceneTransition((s) => ({ ...s, prev: null }))}
					>
						<AnimationRenderer
							scene={prevScene}
							videoClips={videoClips}
							fps={fps}
							showPip={false}
						/>
					</FadeWrapper>
				)}
				{/* Incoming scene — fades in, owns the PiP */}
				{currentScene && (
					<FadeWrapper
						direction="in"
						key={`curr-${currentScene.sceneId}`}
					>
						<AnimationRenderer
							key={currentScene.sceneId}
							scene={currentScene}
							videoClips={videoClips}
							fps={fps}
							showPip={true}
						/>
					</FadeWrapper>
				)}
			</ScaledComposition>
		</div>
	);
}
