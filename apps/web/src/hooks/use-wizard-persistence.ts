"use client";

import { useEffect, useRef } from "react";
import { useWizardStore, type RemovedSegmentRecord } from "@/stores/wizard-store";
import type { TimelineTrack } from "@/types/timeline";

/**
 * Loads wizard state from PostgreSQL on mount and saves it back (debounced)
 * whenever relevant state changes. Only the fields that make sense to restore
 * after a page reload are persisted — mid-processing phases are always reset
 * to "idle" on load.
 */
export function useWizardPersistence(projectId: string) {
	const hasLoaded = useRef(false);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Load once on mount
	useEffect(() => {
		if (hasLoaded.current) return;
		hasLoaded.current = true;

		void (async () => {
			try {
				const res = await fetch(`/api/wizard/${projectId}`);
				if (!res.ok) {
					// 404 = new project — reset any leftover state from a previous project
					useWizardStore.getState().reset();
					return;
				}
				const data = (await res.json()) as {
					currentStep: number;
					selectedLayout: string | null;
					uploadPhase: string;
					removedSegments: RemovedSegmentRecord[];
					preProcessingTracks: TimelineTrack[] | null;
					postProcessingTracks: TimelineTrack[] | null;
				};
				useWizardStore.getState().loadPersisted(data);
			} catch {
				// Non-fatal — wizard just starts fresh
			}
		})();
	}, [projectId]);

	// Debounced save on every store change
	useEffect(() => {
		const unsubscribe = useWizardStore.subscribe((state) => {
			// Only save stable states — never persist mid-processing phases
			const persistablePhase =
				state.uploadPhase === "done" ? "done" : "idle";

			if (saveTimer.current) clearTimeout(saveTimer.current);

			saveTimer.current = setTimeout(() => {
				void fetch(`/api/wizard/${projectId}`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						currentStep: state.currentStep,
						selectedLayout: state.selectedLayout,
						uploadPhase: persistablePhase,
						removedSegments: state.removedSegments,
						preProcessingTracks: state.preProcessingTracks,
						postProcessingTracks: state.postProcessingTracks,
					}),
				});
			}, 600);
		});

		return () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
			unsubscribe();
		};
	}, [projectId]);
}
