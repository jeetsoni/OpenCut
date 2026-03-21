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

/**
 * Root component rendered by Remotion. Lays out all scenes as
 * Sequences so each plays at the correct time.
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
			{compiledScenes.map((scene) => {
				const Comp = scene.Component;
				return (
					<Sequence
						key={scene.sceneId}
						from={scene.startFrame}
						durationInFrames={scene.durationFrames}
					>
						<Comp scene={scene.direction} />
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
