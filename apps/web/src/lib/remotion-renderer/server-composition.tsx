/**
 * Remotion composition for server-side rendering.
 *
 * This file is used by @remotion/renderer on the server to render
 * AI-generated animation code into an MP4. It uses the same compile
 * pipeline as the client (sucrase + sandboxed eval) but runs inside
 * Remotion's headless Chromium.
 *
 * Props are passed via `inputProps` from the API route:
 * - scenes: array of { code, direction, startFrame, durationFrames }
 * - fps, totalFrames, width, height
 */

import React from "react";
import {
	AbsoluteFill,
	Composition,
	Sequence,
	Audio,
	useCurrentFrame,
	useVideoConfig,
	interpolate,
	spring,
	Easing,
	staticFile,
	registerRoot,
} from "remotion";
import { transform } from "sucrase";

/**
 * Inline the direction type so this file has zero @/ imports.
 * Remotion's bundler uses its own webpack and won't resolve
 * the @/* path alias unless we add a webpack override — but
 * keeping this file self-contained is simpler and more robust.
 */
interface SceneDirection {
	[key: string]: unknown;
}

interface SceneInput {
	code: string;
	direction: SceneDirection;
	startFrame: number;
	durationFrames: number;
	sceneId: number;
}

interface AnimationProps {
	scenes: SceneInput[];
}

/**
 * Compile AI-generated code using the same pipeline as the client.
 * Provides the real Remotion hooks (not shims) since we're inside
 * Remotion's rendering context.
 */
function compileCode(code: string): React.FC<{ scene: SceneDirection }> | null {
	try {
		const cleaned = code
			.replace(/^\s*export\s+default\s+/gm, "")
			.replace(/^\s*export\s+/gm, "")
			.replace(/^\s*import\s+.*?;?\s*$/gm, "");

		const transpiled = transform(cleaned, {
			transforms: ["jsx", "typescript"],
			jsxRuntime: "classic",
			production: true,
		}).code;

		const scopeKeys = [
			"React", "useState", "useEffect", "useMemo", "useCallback",
			"AbsoluteFill", "Sequence", "Audio", "useCurrentFrame", "useVideoConfig",
			"interpolate", "spring", "Easing", "staticFile",
		];
		const scopeValues = [
			React, React.useState, React.useEffect, React.useMemo, React.useCallback,
			AbsoluteFill, Sequence, Audio, useCurrentFrame, useVideoConfig,
			interpolate, spring, Easing, staticFile,
		];

		const factory = new Function(
			...scopeKeys,
			`${transpiled}\nreturn Main;`,
		);
		const Component = factory(...scopeValues);

		if (typeof Component !== "function") return null;
		return Component as React.FC<{ scene: SceneDirection }>;
	} catch (err) {
		console.error("[ServerComposition] Compile failed:", err);
		return null;
	}
}

// Cross-dissolve length in frames (0.4s at 30fps — matches CROSSFADE_MS in overlay)
const CROSSFADE_FRAMES = 12;

/**
 * Wraps a compiled scene component with an entry fade-in and (if followed by
 * another scene) an exit fade-out. The parent Sequence is extended by
 * CROSSFADE_FRAMES so the outgoing animation overlaps with the incoming one,
 * producing a proper cross-dissolve instead of a hard cut.
 */
function FadingScene({
	Component,
	direction,
	sceneDuration,
	isFirst,
	isLast,
}: {
	Component: React.FC<{ scene: SceneDirection }>;
	direction: SceneDirection;
	sceneDuration: number;
	isFirst: boolean;
	isLast: boolean;
}) {
	const frame = useCurrentFrame();

	// Fade in at the start of every non-first scene (first scene appears immediately)
	const fadeIn = isFirst
		? 1
		: interpolate(frame, [0, CROSSFADE_FRAMES], [0, 1], {
				extrapolateLeft: "clamp",
				extrapolateRight: "clamp",
		  });

	// Fade out in the extension window beyond the scene's natural duration.
	// isLast scenes don't need an extension — nothing follows them.
	const fadeOut = isLast
		? 1
		: interpolate(frame, [sceneDuration, sceneDuration + CROSSFADE_FRAMES], [1, 0], {
				extrapolateLeft: "clamp",
				extrapolateRight: "clamp",
		  });

	return (
		<AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>
			<Component scene={direction} />
		</AbsoluteFill>
	);
}

/**
 * Root component rendered by Remotion. Lays out all scenes as
 * Sequences so each plays at the correct time.
 * Non-last scenes are extended by CROSSFADE_FRAMES so outgoing and incoming
 * animations overlap and cross-dissolve at every scene boundary.
 */
function AnimationRoot({ scenes }: AnimationProps) {
	const compiledScenes = React.useMemo(() => {
		return scenes
			.map((s) => ({
				...s,
				Component: compileCode(s.code),
			}))
			.filter(
				(s): s is typeof s & { Component: React.FC<{ scene: SceneDirection }> } =>
					s.Component !== null,
			);
	}, [scenes]);

	return (
		<AbsoluteFill style={{ backgroundColor: "transparent" }}>
			{compiledScenes.map((scene, i) => {
				const isFirst = i === 0;
				const isLast = i === compiledScenes.length - 1;
				// Extend the sequence so the outgoing animation can fade out
				// while the next scene's sequence has already started.
				const extension = isLast ? 0 : CROSSFADE_FRAMES;
				return (
					<Sequence
						key={scene.sceneId}
						from={scene.startFrame}
						durationInFrames={scene.durationFrames + extension}
					>
						<FadingScene
							Component={scene.Component}
							direction={scene.direction}
							sceneDuration={scene.durationFrames}
							isFirst={isFirst}
							isLast={isLast}
						/>
					</Sequence>
				);
			})}
		</AbsoluteFill>
	);
}

/**
 * Remotion root that registers the composition.
 * Used by @remotion/renderer's bundle() as the entry point.
 */
function RemotionRoot() {
	return (
		<Composition
			id="animation"
			component={AnimationRoot as React.FC}
			durationInFrames={1}
			fps={30}
			width={1080}
			height={1920}
			defaultProps={{ scenes: [] as SceneInput[] }}
		/>
	);
}

registerRoot(RemotionRoot);
