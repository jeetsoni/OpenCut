/**
 * In-browser transpile + eval for AI-generated Remotion components.
 *
 * Uses Sucrase to transform JSX → React.createElement calls,
 * then evaluates the code in a sandboxed scope with only
 * Remotion primitives available.
 *
 * Two compile modes:
 * - `compileRemotionCode`: uses real Remotion hooks (for @remotion/player)
 * - `compileForEditorOverlay`: uses shim hooks that read from EditorFrameContext
 */

import { transform } from "sucrase";
import React from "react";
import {
	AbsoluteFill,
	Sequence,
	Audio,
	useCurrentFrame,
	useVideoConfig,
	interpolate,
	spring,
	Easing,
	staticFile,
} from "remotion";
import type { ScenePlan } from "@/lib/scene-planner/schema";

/**
 * Context for the editor overlay mode — provides frame and fps
 * from the editor's playback clock instead of Remotion's internals.
 */
export const EditorFrameContext = React.createContext<{
	frame: number;
	fps: number;
}>({ frame: 0, fps: 30 });

function useEditorFrame(): number {
	return React.useContext(EditorFrameContext).frame;
}

function useEditorVideoConfig() {
	const { fps } = React.useContext(EditorFrameContext);
	return {
		fps,
		width: 1080,
		height: 1920,
		durationInFrames: 99999,
		id: "editor-overlay",
		defaultCodec: "h264" as const,
	};
}

/**
 * Sequence shim for editor overlay mode.
 * Renders children only when the current frame is within range.
 */
function SequenceShim({
	from = 0,
	durationInFrames = Infinity,
	children,
}: {
	from?: number;
	durationInFrames?: number;
	children: React.ReactNode;
}) {
	const frame = useEditorFrame();
	const { fps } = React.useContext(EditorFrameContext);
	const relativeFrame = frame - from;
	if (relativeFrame < 0 || relativeFrame >= durationInFrames) return null;

	return React.createElement(
		EditorFrameContext.Provider,
		{ value: { frame: relativeFrame, fps } },
		children,
	);
}

/**
 * Audio shim for editor overlay — renders nothing since AudioManager handles playback.
 */
function AudioShim() {
	return null;
}

/**
 * staticFile shim for editor overlay — returns the public path directly.
 */
function staticFileShim(path: string): string {
	return `/${path}`;
}

/** Base scope shared between both compile modes */
const BASE_SCOPE = {
	React,
	useState: React.useState,
	useEffect: React.useEffect,
	useMemo: React.useMemo,
	useCallback: React.useCallback,
	AbsoluteFill,
	interpolate,
	spring,
	Easing,
};

/** Scope for @remotion/player mode */
const PLAYER_SCOPE = {
	...BASE_SCOPE,
	Sequence,
	Audio,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
};

/** Scope for editor overlay mode (shim hooks) */
const EDITOR_SCOPE = {
	...BASE_SCOPE,
	Sequence: SequenceShim,
	Audio: AudioShim,
	staticFile: staticFileShim,
	useCurrentFrame: useEditorFrame,
	useVideoConfig: useEditorVideoConfig,
};

const PLAYER_KEYS = Object.keys(PLAYER_SCOPE);
const PLAYER_VALUES = Object.values(PLAYER_SCOPE);
const EDITOR_KEYS = Object.keys(EDITOR_SCOPE);
const EDITOR_VALUES = Object.values(EDITOR_SCOPE);

export interface CompileResult {
	Component: React.FC<{ scenePlan: ScenePlan }>;
	error: null;
}

export interface CompileError {
	Component: null;
	error: string;
}

function compileWithScope(
	code: string,
	scopeKeys: string[],
	scopeValues: unknown[],
): CompileResult | CompileError {
	try {
		// Strip export/import statements — the sandbox provides all dependencies via scope.
		// AI-generated code sometimes includes `export` on component declarations.
		const cleaned = code
			.replace(/^\s*export\s+default\s+/gm, "")
			.replace(/^\s*export\s+/gm, "")
			.replace(/^\s*import\s+.*?;?\s*$/gm, "");

		const transpiled = transform(cleaned, {
			transforms: ["jsx", "typescript"],
			jsxRuntime: "classic",
			production: true,
		}).code;

		const wrappedCode = `
			${transpiled}
			return Main;
		`;

		// biome-ignore lint/security/noGlobalEval: intentional sandboxed eval for AI-generated Remotion code
		const factory = new Function(...scopeKeys, wrappedCode);
		const Component = factory(...scopeValues);

		if (typeof Component !== "function") {
			return {
				Component: null,
				error: "Generated code did not produce a valid React component.",
			};
		}

		return { Component, error: null };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { Component: null, error: `Compilation failed: ${message}` };
	}
}

/**
 * Compile for use inside @remotion/player (real Remotion hooks).
 */
export function compileRemotionCode(
	code: string,
): CompileResult | CompileError {
	return compileWithScope(code, PLAYER_KEYS, PLAYER_VALUES);
}

/**
 * Compile for use in the editor overlay (shim hooks reading from EditorFrameContext).
 */
export function compileForEditorOverlay(
	code: string,
): CompileResult | CompileError {
	return compileWithScope(code, EDITOR_KEYS, EDITOR_VALUES);
}
