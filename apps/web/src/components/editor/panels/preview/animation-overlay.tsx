/**
 * Animation overlay for the main editor preview.
 *
 * Subscribes to the scene store for compiled animations.
 * Renders the active scene's animation on top of the canvas,
 * synced to the editor's playback clock.
 * Includes a PiP face cam (muted — audio comes from the main canvas).
 */

"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import React from "react";
import { useEditor } from "@/hooks/use-editor";
import { useSceneStore } from "@/stores/scene-store";
import { getSceneRemotionCode } from "@/lib/remotion-renderer/scene-code-store";
import {
	compileForEditorOverlay,
	EditorFrameContext,
} from "@/lib/remotion-renderer/compile";
import type { PlannedScene } from "@/lib/scene-planner/schema";
import type { VideoElement } from "@/types/timeline";

interface VideoClip {
	src: string;
	startTime: number;
	duration: number;
	trimStart: number;
}

const COMP_WIDTH = 1080;
const COMP_HEIGHT = 1920;

interface CompiledScene {
	sceneId: number;
	startTime: number;
	endTime: number;
	Component: React.FC<{ scene: PlannedScene }>;
	direction: PlannedScene;
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
	const currentTime = editor.playback.getCurrentTime();
	const isPlaying = editor.playback.getIsPlaying();
	const fps = activeProject?.settings.fps ?? 30;
	const tracks = editor.timeline.getTracks();
	const mediaAssets = editor.media.getAssets();

	const projectId = activeProject?.metadata.id;

	// Subscribe to scene store
	const boundaries = useSceneStore((s) => s.boundaries);
	const sceneStatuses = useSceneStore((s) => s.sceneStatuses);

	// Compile scenes that have animation code — recompile when statuses change
	const [compiledScenes, setCompiledScenes] = useState<CompiledScene[]>([]);

	useEffect(() => {
		if (!projectId || !boundaries) {
			setCompiledScenes([]);
			return;
		}

		let cancelled = false;

		async function compile() {
			const scenes: CompiledScene[] = [];

			for (const b of boundaries!.boundaries) {
				const status = sceneStatuses[b.id];
				if (!status?.hasAnimation || !status?.direction) continue;

				const codeResult = await getSceneRemotionCode({ projectId: projectId!, sceneId: b.id });
				if (!codeResult) continue;

				const compiled = compileForEditorOverlay(codeResult.code);
				if (compiled.Component) {
					scenes.push({
						sceneId: b.id,
						startTime: b.startTime,
						endTime: b.endTime,
						Component: compiled.Component as unknown as React.FC<{ scene: PlannedScene }>,
						direction: status.direction,
					});
				}
			}

			if (!cancelled) setCompiledScenes(scenes);
		}

		compile();
		return () => { cancelled = true; };
	}, [projectId, boundaries, sceneStatuses]);

	// Extract video clips for PiP
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

	// Find active scene based on playback time
	const activeScene = useMemo(() => {
		return compiledScenes.find(
			(s) => currentTime >= s.startTime && currentTime < s.endTime,
		);
	}, [compiledScenes, currentTime]);

	if (!activeScene) return null;

	const { Component, direction } = activeScene;
	const sceneFrame = Math.floor((currentTime - activeScene.startTime) * fps);
	const hasClips = videoClips.length > 0;

	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			<ScaledComposition>
				<EditorFrameContext.Provider value={{ frame: sceneFrame, fps }}>
					<Component scene={direction} />
				</EditorFrameContext.Provider>

				{hasClips && (
					<div
						style={{
							position: "absolute",
							bottom: 40,
							right: 40,
							width: "25%",
							aspectRatio: "9/16",
							borderRadius: 16,
							overflow: "hidden",
							border: "2px solid rgba(255,255,255,0.15)",
							boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
						}}
					>
						<SyncedPipVideo clips={videoClips} currentTime={currentTime} isPlaying={isPlaying} />
					</div>
				)}
			</ScaledComposition>
		</div>
	);
}
