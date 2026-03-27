import { create } from "zustand";
import type { TimelineTrack } from "@/types/timeline";

export interface RemovedRetakeSegment {
	id: string;
	trackId: string;
	/** Original element ID before removal */
	originalElementId: string;
	/** Source media start time */
	sourceStart: number;
	/** Source media end time */
	sourceEnd: number;
	/** Timeline position where it was */
	timelineStart: number;
	/** Duration of removed segment */
	duration: number;
	/** Transcript text if available */
	transcript?: string;
	/** Human-readable label */
	label: string;
	/** Whether this segment has been restored */
	isRestored?: boolean;
}

export interface RetakesRemovalRecord {
	id: string;
	timestamp: number;
	/** Tracks state before removal */
	tracksBefore: TimelineTrack[];
	/** Tracks state after removal */
	tracksAfter: TimelineTrack[];
	/** Segments that were removed */
	removedSegments: RemovedRetakeSegment[];
}

interface RetakesState {
	/** History of retakes removal operations */
	removalHistory: RetakesRemovalRecord[];
	/** Currently selected record for review */
	activeRecordId: string | null;
	/** Dialog open state */
	isReviewDialogOpen: boolean;

	addRemovalRecord: (record: RetakesRemovalRecord) => void;
	setActiveRecord: (id: string | null) => void;
	openReviewDialog: (recordId?: string) => void;
	closeReviewDialog: () => void;
	clearHistory: () => void;
	/** Mark a segment as restored */
	markSegmentRestored: (recordId: string, segmentId: string) => void;
}

export const useRetakesStore = create<RetakesState>()((set, get) => ({
	removalHistory: [],
	activeRecordId: null,
	isReviewDialogOpen: false,

	addRemovalRecord: (record) =>
		set((state) => ({
			removalHistory: [record, ...state.removalHistory].slice(0, 10), // Keep last 10
			activeRecordId: record.id,
		})),

	setActiveRecord: (id) => set({ activeRecordId: id }),

	openReviewDialog: (recordId) => {
		const state = get();
		const id = recordId ?? state.removalHistory[0]?.id ?? null;
		set({ isReviewDialogOpen: true, activeRecordId: id });
	},

	closeReviewDialog: () => set({ isReviewDialogOpen: false }),

	clearHistory: () => set({ removalHistory: [], activeRecordId: null }),

	markSegmentRestored: (recordId, segmentId) =>
		set((state) => ({
			removalHistory: state.removalHistory.map((record) =>
				record.id === recordId
					? {
							...record,
							removedSegments: record.removedSegments.map((seg) =>
								seg.id === segmentId ? { ...seg, isRestored: true } : seg,
							),
						}
					: record,
			),
		})),
}));
