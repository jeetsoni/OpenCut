import { create } from "zustand";
import type { TimelineTrack } from "@/types/timeline";
import type { WizardLayoutId } from "@/types/wizard";

export interface RemovedSegmentRecord {
	trackId: string;
	elementId: string;
	startTime: number;
	duration: number;
	/** Human-readable label, e.g. "0:03 – 0:11 (8s)" */
	label: string;
	isRestored: boolean;
}

export type UploadPhase =
	| "idle"
	| "processing-file"
	| "removing-silence"
	| "removing-retakes"
	| "done"
	| "error";

export type PipelinePhase =
	| "idle"
	| "gaps"
	| "transcript"
	| "boundaries"
	| "directions"
	| "animations"
	| "done"
	| "error";

interface WizardState {
	currentStep: 0 | 1 | 2 | 3;
	selectedLayout: WizardLayoutId | null;
	projectId: string | null;

	uploadPhase: UploadPhase;
	uploadMessage: string;

	/** Snapshot of tracks before silence/retake removal */
	preProcessingTracks: TimelineTrack[] | null;
	/** Snapshot of tracks after silence/retake removal */
	postProcessingTracks: TimelineTrack[] | null;
	removedSegments: RemovedSegmentRecord[];

	pipelinePhase: PipelinePhase;
	pipelineMessage: string;
	/** Per-scene direction progress counter */
	directionProgress: { current: number; total: number } | null;
	/** Per-scene animation code progress counter */
	animationProgress: { current: number; total: number } | null;

	setStep: (step: 0 | 1 | 2 | 3) => void;
	setLayout: (id: WizardLayoutId) => void;
	setProjectId: (id: string) => void;
	setUploadPhase: (phase: UploadPhase, message?: string) => void;
	setProcessingSnapshots: (
		pre: TimelineTrack[],
		post: TimelineTrack[],
	) => void;
	setRemovedSegments: (segments: RemovedSegmentRecord[]) => void;
	toggleSegmentRestored: (elementId: string) => void;
	restoreAllSegments: () => void;
	setPipelinePhase: (phase: PipelinePhase, message?: string) => void;
	setDirectionProgress: (progress: { current: number; total: number }) => void;
	setAnimationProgress: (progress: { current: number; total: number }) => void;
	incrementAnimationProgress: () => void;
	reset: () => void;
	/** Hydrate store from a persisted DB record (called on wizard mount) */
	loadPersisted: (data: {
		currentStep: number;
		selectedLayout: string | null;
		uploadPhase: string;
		removedSegments: RemovedSegmentRecord[];
		preProcessingTracks: TimelineTrack[] | null;
		postProcessingTracks: TimelineTrack[] | null;
	}) => void;
}

const initialState = {
	currentStep: 0 as const,
	selectedLayout: null,
	projectId: null,
	uploadPhase: "idle" as const,
	uploadMessage: "",
	preProcessingTracks: null,
	postProcessingTracks: null,
	removedSegments: [],
	pipelinePhase: "idle" as const,
	pipelineMessage: "",
	directionProgress: null,
	animationProgress: null,
};

export const useWizardStore = create<WizardState>()((set) => ({
	...initialState,

	setStep: (step) => set({ currentStep: step }),
	setLayout: (id) => set({ selectedLayout: id }),
	setProjectId: (id) => set({ projectId: id }),

	setUploadPhase: (phase, message = "") =>
		set({ uploadPhase: phase, uploadMessage: message }),

	setProcessingSnapshots: (pre, post) =>
		set({ preProcessingTracks: pre, postProcessingTracks: post }),

	setRemovedSegments: (segments) => set({ removedSegments: segments }),

	toggleSegmentRestored: (elementId) =>
		set((state) => ({
			removedSegments: state.removedSegments.map((s) =>
				s.elementId === elementId ? { ...s, isRestored: !s.isRestored } : s,
			),
		})),

	restoreAllSegments: () =>
		set((state) => ({
			removedSegments: state.removedSegments.map((s) => ({
				...s,
				isRestored: true,
			})),
		})),

	setPipelinePhase: (phase, message = "") =>
		set({ pipelinePhase: phase, pipelineMessage: message }),

	setDirectionProgress: (progress) => set({ directionProgress: progress }),

	setAnimationProgress: (progress) => set({ animationProgress: progress }),

	incrementAnimationProgress: () =>
		set((state) => {
			if (!state.animationProgress) return state;
			return {
				animationProgress: {
					...state.animationProgress,
					current: state.animationProgress.current + 1,
				},
			};
		}),

	reset: () => set(initialState),

	loadPersisted: (data) =>
		set({
			currentStep: (data.currentStep as 0 | 1 | 2 | 3) ?? 0,
			selectedLayout: (data.selectedLayout as WizardLayoutId | null) ?? null,
			// Never restore a mid-processing phase — user would need to re-upload
			uploadPhase: data.uploadPhase === "done" ? "done" : "idle",
			removedSegments: data.removedSegments ?? [],
			preProcessingTracks: data.preProcessingTracks ?? null,
			postProcessingTracks: data.postProcessingTracks ?? null,
		}),
}));
