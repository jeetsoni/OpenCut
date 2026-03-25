/**
 * Zustand store for scene boundaries and per-scene state.
 *
 * Single source of truth — no polling. Components call `loadBoundaries()`
 * once on mount, and action handlers call `refreshScene()` or
 * `loadBoundaries()` after mutations.
 */

import { create } from "zustand";
import type { SceneBoundaries, SceneBoundary } from "@/lib/scene-planner/boundaries";
import type { PlannedScene } from "@/lib/scene-planner/schema";
import {
	getProjectBoundaries,
	setProjectBoundaries as persistBoundaries,
} from "@/lib/scene-planner/boundaries-store";
import { getSceneDirection } from "@/lib/scene-planner/scene-direction-store";
import { getSceneRemotionCode } from "@/lib/remotion-renderer/scene-code-store";

export interface SceneStatus {
	hasDirection: boolean;
	hasAnimation: boolean;
	direction: PlannedScene | null;
	/** Runtime error from the animation component, if any */
	animationError: string | null;
}

interface SceneState {
	/** Current project's boundaries (null = not loaded or none) */
	boundaries: SceneBoundaries | null;
	/** Currently selected scene id (shown in inspector) */
	selectedSceneId: number | null;
	/** When set, SceneSection auto-opens its tweak panel for this scene id */
	tweakOpenSceneId: number | null;
	/** Per-scene status cache */
	sceneStatuses: Record<number, SceneStatus>;
	/** Maps timeline element IDs to scene boundary IDs */
	elementSceneMap: Record<string, number>;
	/** Loading flag */
	loading: boolean;

	/** Load boundaries + statuses from IndexedDB for a project */
	loadBoundaries: (projectId: string) => Promise<void>;
	/** Set boundaries (after detection or edit) and persist */
	setBoundaries: (projectId: string, boundaries: SceneBoundaries) => Promise<void>;
	/** Select a scene (opens inspector) */
	selectScene: (sceneId: number | null) => void;
	/** Signal SceneSection to auto-open its tweak panel */
	setTweakOpenSceneId: (sceneId: number | null) => void;
	/** Refresh a single scene's status from IndexedDB */
	refreshScene: (projectId: string, sceneId: number) => Promise<void>;
	/** Set a runtime animation error for a scene */
	setSceneError: (sceneId: number, error: string | null) => void;
	/** Set the element→scene mapping after splits */
	setElementSceneMap: (map: Record<string, number>) => void;
	/** Get scene ID for a given element */
	getSceneForElement: (elementId: string) => number | undefined;
	/** Clear everything (project switch) */
	clear: () => void;
}

export const useSceneStore = create<SceneState>()((set, get) => ({
	boundaries: null,
	selectedSceneId: null,
	tweakOpenSceneId: null,
	sceneStatuses: {},
	elementSceneMap: {},
	loading: false,

	loadBoundaries: async (projectId) => {
		set({ loading: true });
		const boundaries = await getProjectBoundaries({ projectId });
		if (!boundaries) {
			set({ boundaries: null, sceneStatuses: {}, loading: false });
			return;
		}

		const statuses: Record<number, SceneStatus> = {};
		await Promise.all(
			boundaries.boundaries.map(async (b) => {
				const [dir, code] = await Promise.all([
					getSceneDirection({ projectId, sceneId: b.id }),
					getSceneRemotionCode({ projectId, sceneId: b.id }),
				]);
				statuses[b.id] = {
					hasDirection: Boolean(dir),
					hasAnimation: Boolean(code),
					direction: dir,
					animationError: null,
				};
			}),
		);

		set({ boundaries, sceneStatuses: statuses, loading: false });

		// Rebuild element→scene mapping from current timeline state.
		// This ensures the map survives page refreshes.
		try {
			const { EditorCore } = await import("@/core");
			const editor = EditorCore.getInstance();
			const tracks = editor.timeline.getTracks();
			const elementSceneMap: Record<string, number> = {};
			for (const track of tracks) {
				for (const el of track.elements) {
					const elMid = el.startTime + el.duration / 2;
					const match = boundaries.boundaries.find(
						(b) => elMid >= b.startTime && elMid < b.endTime,
					);
					if (match) {
						elementSceneMap[el.id] = match.id;
					}
				}
			}
			set({ elementSceneMap });
		} catch {
			// EditorCore may not be ready yet — map will be built later
		}
	},

	setBoundaries: async (projectId, boundaries) => {
		set({ boundaries });
		await persistBoundaries({ projectId, boundaries });
	},

	selectScene: (sceneId) => set({ selectedSceneId: sceneId }),

	setTweakOpenSceneId: (sceneId) => set({ tweakOpenSceneId: sceneId }),

	setElementSceneMap: (map) => set({ elementSceneMap: map }),

	getSceneForElement: (elementId) => get().elementSceneMap[elementId],

	refreshScene: async (projectId, sceneId) => {
		const [dir, code] = await Promise.all([
			getSceneDirection({ projectId, sceneId }),
			getSceneRemotionCode({ projectId, sceneId }),
		]);
		set((state) => ({
			sceneStatuses: {
				...state.sceneStatuses,
				[sceneId]: {
					hasDirection: Boolean(dir),
					hasAnimation: Boolean(code),
					direction: dir,
					animationError: null,
				},
			},
		}));
	},

	setSceneError: (sceneId, error) => {
		set((state) => {
			const existing = state.sceneStatuses[sceneId];
			if (!existing) return state;
			return {
				sceneStatuses: {
					...state.sceneStatuses,
					[sceneId]: { ...existing, animationError: error },
				},
			};
		});
	},

	clear: () =>
		set({
			boundaries: null,
			selectedSceneId: null,
			sceneStatuses: {},
			elementSceneMap: {},
			loading: false,
		}),
}));
