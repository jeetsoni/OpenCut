import { Command } from "@/lib/commands/base-command";
import type { TimelineTrack } from "@/types/timeline";
import { EditorCore } from "@/core";

/**
 * Merges adjacent elements on each track that share the same media source
 * and are contiguous both on the timeline and in source time.
 *
 * This reverses previous split operations (e.g. from an earlier scene
 * boundary detection) where clips were cut but the source ranges remain
 * back-to-back. Clips separated by retake removal (which creates source
 * gaps) are intentionally NOT merged — merging them would re-introduce
 * the removed retake frames.
 *
 * Used before scene boundary detection so that previously-split clips
 * are recombined, then re-split only at the new boundary times.
 */
export class MergeAdjacentElementsCommand extends Command {
	private savedState: TimelineTrack[] | null = null;

	execute(): void {
		const editor = EditorCore.getInstance();
		this.savedState = editor.timeline.getTracks();

		const updatedTracks = this.savedState.map((track) => {
			if (track.elements.length <= 1) return track;

			const sorted = [...track.elements].sort(
				(a, b) => a.startTime - b.startTime,
			);
			const merged: typeof sorted = [{ ...sorted[0] }];

			for (let i = 1; i < sorted.length; i++) {
				const prev = merged[merged.length - 1];
				const curr = sorted[i];

				// Same media source?
				const sameMedia =
					"mediaId" in prev &&
					"mediaId" in curr &&
					(prev as { mediaId: string }).mediaId ===
						(curr as { mediaId: string }).mediaId;

				// Adjacent on the timeline? (no visible gap)
				const timelineContiguous =
					Math.abs(prev.startTime + prev.duration - curr.startTime) < 0.01;

				// Contiguous in source time? (prev's source end ≈ curr's source start)
				// This is true for clips created by split operations, but false for
				// clips separated by retake/silence removal.
				const prevSourceEnd = prev.trimStart + prev.duration;
				const sourceContiguous =
					sameMedia && Math.abs(prevSourceEnd - curr.trimStart) < 0.05;

				if (sameMedia && timelineContiguous && sourceContiguous) {
					// Absorb curr into prev — safe because source ranges are contiguous
					merged[merged.length - 1] = {
						...prev,
						duration: prev.duration + curr.duration,
						trimEnd: curr.trimEnd,
						name: prev.name.replace(/ \((left|right)\)$/, ""),
					};
				} else {
					merged.push({ ...curr });
				}
			}

			if (merged.length === sorted.length) return track;

			const sortedIds = new Set(sorted.map((el) => el.id));
			const untouched = track.elements.filter((el) => !sortedIds.has(el.id));

			return {
				...track,
				elements: [...untouched, ...merged],
			} as typeof track;
		});

		editor.timeline.updateTracks(updatedTracks);
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
