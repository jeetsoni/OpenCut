/**
 * Remotion animation preview with synced face cam (PiP).
 *
 * Compiles AI-generated Remotion code and renders it in a
 * @remotion/player. The user's edited video (with all cuts/trims)
 * plays in a picture-in-picture window with audio.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import {
	AbsoluteFill,
	Sequence,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import type { ScenePlan } from "@/lib/scene-planner/schema";
import { compileRemotionCode } from "@/lib/remotion-renderer/compile";

/** A trimmed video clip from the timeline. */
export interface VideoClip {
	/** Blob URL of the source video file */
	src: string;
	/** Where this clip starts on the timeline (seconds) */
	startTime: number;
	/** Playable duration on the timeline (seconds) */
	duration: number;
	/** Offset into the source file where playback begins (seconds) */
	trimStart: number;
}

function ErrorFallback({ error }: { error: string }) {
	return (
		<div
			style={{
				width: "100%",
				height: "100%",
				backgroundColor: "#0D0E14",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: 32,
			}}
		>
			<div
				style={{
					color: "#F55B5B",
					fontSize: 14,
					fontFamily: "monospace",
					whiteSpace: "pre-wrap",
					maxWidth: 500,
					textAlign: "center",
				}}
			>
				{error}
			</div>
		</div>
	);
}

function SafeRenderer({
	Component,
	scenePlan,
}: {
	Component: React.FC<{ scenePlan: ScenePlan }>;
	scenePlan: ScenePlan;
}) {
	const [renderError, setRenderError] = useState<string | null>(null);

	useEffect(() => {
		setRenderError(null);
	}, [Component]);

	if (renderError) {
		return <ErrorFallback error={renderError} />;
	}

	try {
		return <Component scenePlan={scenePlan} />;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		queueMicrotask(() => setRenderError(msg));
		return <ErrorFallback error={msg} />;
	}
}

/**
 * A single synced video clip. Plays the source video from trimStart
 * offset, following Remotion's frame clock for this Sequence.
 */
function SyncedClip({ src, trimStart }: { src: string; trimStart: number }) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const videoRef = useRef<HTMLVideoElement>(null);
	const lastSyncedFrame = useRef(0);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		if (frame === lastSyncedFrame.current) return;

		const prevFrame = lastSyncedFrame.current;
		lastSyncedFrame.current = frame;

		// frame is relative to this Sequence, so add trimStart
		const targetTime = trimStart + frame / fps;
		const isPlaying = frame === prevFrame + 1;

		if (isPlaying) {
			if (video.paused) {
				video.currentTime = targetTime;
				video.play().catch(() => {});
			} else if (Math.abs(video.currentTime - targetTime) > 0.15) {
				video.currentTime = targetTime;
			}
		} else {
			if (!video.paused) video.pause();
			video.currentTime = targetTime;
		}
	}, [frame, fps, trimStart]);

	return (
		<video
			ref={videoRef}
			src={src}
			playsInline
			preload="auto"
			style={{ width: "100%", height: "100%", objectFit: "cover" }}
		/>
	);
}

/**
 * Renders the edited timeline video as a series of Sequences,
 * each playing the correct trimmed portion of the source.
 */
function EditedVideoTrack({
	clips,
	fps,
}: {
	clips: VideoClip[];
	fps: number;
}) {
	return (
		<AbsoluteFill>
			{clips.map((clip, i) => {
				const fromFrame = Math.round(clip.startTime * fps);
				const durationFrames = Math.max(1, Math.round(clip.duration * fps));
				return (
					<Sequence
						key={i}
						from={fromFrame}
						durationInFrames={durationFrames}
					>
						<SyncedClip src={clip.src} trimStart={clip.trimStart} />
					</Sequence>
				);
			})}
		</AbsoluteFill>
	);
}

/**
 * PiP composite: animations fullscreen, edited face cam in corner.
 */
function PipPreview({
	AnimationComponent,
	scenePlan,
	clips,
}: {
	AnimationComponent: React.FC<{ scenePlan: ScenePlan }>;
	scenePlan: ScenePlan;
	clips: VideoClip[];
}) {
	return (
		<AbsoluteFill>
			<SafeRenderer Component={AnimationComponent} scenePlan={scenePlan} />
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
				<EditedVideoTrack clips={clips} fps={scenePlan.fps} />
			</div>
		</AbsoluteFill>
	);
}

export function RemotionPreview({
	code,
	scenePlan,
	videoClips,
	width = 640,
	height = 360,
}: {
	code: string;
	scenePlan: ScenePlan;
	videoClips?: VideoClip[];
	width?: number;
	height?: number;
}) {
	const playerRef = useRef<PlayerRef>(null);
	const compiled = useMemo(() => compileRemotionCode(code), [code]);

	const hasClips = videoClips && videoClips.length > 0;

	const WrappedComponent = useCallback(() => {
		if (compiled.error || !compiled.Component) {
			return (
				<ErrorFallback
					error={compiled.error || "Unknown compile error"}
				/>
			);
		}
		if (hasClips) {
			return (
				<PipPreview
					AnimationComponent={compiled.Component}
					scenePlan={scenePlan}
					clips={videoClips}
				/>
			);
		}
		return (
			<SafeRenderer
				Component={compiled.Component}
				scenePlan={scenePlan}
			/>
		);
	}, [compiled, scenePlan, videoClips, hasClips]);

	const durationInFrames = Math.max(scenePlan.totalFrames, 1);

	return (
		<div className="rounded-lg overflow-hidden border border-border bg-black">
			<Player
				ref={playerRef}
				component={WrappedComponent}
				durationInFrames={durationInFrames}
				compositionWidth={1080}
				compositionHeight={1920}
				fps={scenePlan.fps}
				style={{ width, height }}
				controls
				loop
				autoPlay={false}
			/>
		</div>
	);
}
