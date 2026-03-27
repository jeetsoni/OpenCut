"use client";

import { useCallback } from "react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogBody,
	DialogFooter,
	DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditor } from "@/hooks/use-editor";
import { useRetakesStore, type RemovedRetakeSegment } from "@/stores/retakes-store";
import { Play, Undo2, Check } from "lucide-react";
import { cn } from "@/utils/ui";
import { toast } from "sonner";

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

interface SegmentCardProps {
	segment: RemovedRetakeSegment;
	onPreview: (time: number) => void;
	onRestore: () => void;
}

function SegmentCard({ segment, onPreview, onRestore }: SegmentCardProps) {
	return (
		<div className={cn(
			"rounded-lg border p-3 text-sm transition-colors",
			segment.isRestored
				? "border-primary/30 bg-primary/5"
				: "border-border bg-card"
		)}>
			<div className="flex items-start justify-between gap-3">
				<div className="flex-1 min-w-0">
					<p className="text-foreground font-medium">{segment.label}</p>
					{segment.transcript && (
						<p className="text-muted-foreground text-xs mt-1 line-clamp-2">
							"{segment.transcript}"
						</p>
					)}
					{segment.isRestored && (
						<p className="text-primary text-xs mt-1 flex items-center gap-1">
							<Check className="size-3" />
							Restored
						</p>
					)}
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<button
						type="button"
						onClick={() => onPreview(Math.max(0, segment.timelineStart - 0.5))}
						className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
					>
						<Play className="size-3" />
						Preview
					</button>
					{!segment.isRestored && (
						<button
							type="button"
							onClick={onRestore}
							className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
						>
							Restore
						</button>
					)}
				</div>
			</div>
		</div>
	);
}


export function RetakesReviewDialog() {
	const editor = useEditor();
	const {
		isReviewDialogOpen,
		closeReviewDialog,
		removalHistory,
		activeRecordId,
		setActiveRecord,
		markSegmentRestored,
	} = useRetakesStore();

	const activeRecord = removalHistory.find((r) => r.id === activeRecordId);

	const handlePreview = useCallback(
		(time: number) => {
			editor.playback.seek({ time });
		},
		[editor],
	);

	const handleRestoreSegment = useCallback(
		(segment: RemovedRetakeSegment) => {
			if (!activeRecord) return;

			// Get current tracks
			const currentTracks = editor.timeline.getTracks();

			// Find the track where this segment belongs
			const trackIndex = currentTracks.findIndex((t) => t.id === segment.trackId);
			if (trackIndex === -1) {
				toast.error("Track not found");
				return;
			}

			// Find the original element from tracksBefore to get its properties
			const originalTrack = activeRecord.tracksBefore.find((t) => t.id === segment.trackId);
			const originalElement = originalTrack?.elements.find(
				(e) => e.id === segment.originalElementId,
			);

			if (!originalElement) {
				toast.error("Original element not found");
				return;
			}

			// Create a new element for the restored segment
			const restoredElement = {
				...originalElement,
				id: `restored-${segment.id}-${Math.random().toString(36).slice(2, 6)}`,
				startTime: segment.timelineStart,
				duration: segment.duration,
				trimStart: segment.sourceStart,
				trimEnd:
					(originalElement.sourceDuration ??
						originalElement.trimStart + originalElement.duration + originalElement.trimEnd) -
					segment.sourceStart -
					segment.duration,
			};

			// Add the element to the track - use type assertion since we're preserving track structure
			const targetTrack = currentTracks[trackIndex];
			const newElements = [...targetTrack.elements, restoredElement as typeof targetTrack.elements[number]].sort(
				(a, b) => a.startTime - b.startTime,
			);
			const updatedTrack = { ...targetTrack, elements: newElements } as typeof targetTrack;
			
			const updatedTracks = currentTracks.map((track, idx) =>
				idx === trackIndex ? updatedTrack : track,
			);

			editor.timeline.updateTracks(updatedTracks);
			markSegmentRestored(activeRecord.id, segment.id);
			toast.success("Clip restored", {
				description: segment.transcript
					? `"${segment.transcript.slice(0, 50)}${segment.transcript.length > 50 ? "..." : ""}"`
					: segment.label,
			});
		},
		[activeRecord, editor, markSegmentRestored],
	);

	const handleUndoAll = useCallback(() => {
		if (!activeRecord) return;
		editor.timeline.updateTracks(activeRecord.tracksBefore);
		closeReviewDialog();
		toast.success("All clips restored");
	}, [activeRecord, editor, closeReviewDialog]);

	const totalRemovedTime = activeRecord?.removedSegments.reduce(
		(sum, s) => sum + s.duration,
		0,
	) ?? 0;

	const unrestoredCount = activeRecord?.removedSegments.filter((s) => !s.isRestored).length ?? 0;

	return (
		<Dialog open={isReviewDialogOpen} onOpenChange={(open) => !open && closeReviewDialog()}>
			<DialogContent
				className="max-w-2xl"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle>Removed Retakes</DialogTitle>
					<DialogDescription>
						{activeRecord
							? `${activeRecord.removedSegments.length} segment${activeRecord.removedSegments.length !== 1 ? "s" : ""} removed — ${totalRemovedTime.toFixed(1)}s total`
							: "No retakes removal history"}
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="p-0">
					{!activeRecord ? (
						<div className="flex flex-col items-center justify-center gap-3 py-12">
							<p className="text-muted-foreground text-sm">
								No retakes have been removed yet.
							</p>
						</div>
					) : activeRecord.removedSegments.length === 0 ? (
						<div className="flex flex-col items-center justify-center gap-3 py-12">
							<p className="text-muted-foreground text-sm">
								No segments were identified as retakes.
							</p>
						</div>
					) : (
						<ScrollArea className="h-[400px] px-6 py-4">
							<div className="space-y-2">
								{activeRecord.removedSegments.map((segment) => (
									<SegmentCard
										key={segment.id}
										segment={segment}
										onPreview={handlePreview}
										onRestore={() => handleRestoreSegment(segment)}
									/>
								))}
							</div>
						</ScrollArea>
					)}

					{/* History selector if multiple records */}
					{removalHistory.length > 1 && (
						<div className="border-t border-border px-6 py-3">
							<p className="text-muted-foreground text-xs mb-2">Previous removals:</p>
							<div className="flex flex-wrap gap-2">
								{removalHistory.map((record) => (
									<button
										key={record.id}
										type="button"
										onClick={() => setActiveRecord(record.id)}
										className={cn(
											"text-xs px-2 py-1 rounded transition-colors",
											record.id === activeRecordId
												? "bg-primary text-primary-foreground"
												: "bg-muted text-muted-foreground hover:bg-muted/80",
										)}
									>
										{new Date(record.timestamp).toLocaleTimeString()} ({record.removedSegments.length})
									</button>
								))}
							</div>
						</div>
					)}
				</DialogBody>

				<DialogFooter>
					{activeRecord && unrestoredCount > 0 && (
						<Button variant="outline" onClick={handleUndoAll}>
							<Undo2 className="size-4 mr-2" />
							Restore All ({unrestoredCount})
						</Button>
					)}
					<Button onClick={closeReviewDialog}>Done</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
