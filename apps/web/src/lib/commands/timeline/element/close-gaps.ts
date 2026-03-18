import { Command } from "@/lib/commands/base-command";
import type { TimelineTrack } from "@/types/timeline";
import { EditorCore } from "@/core";

/**
 * Closes all gaps between elements on each track by shifting
 * elements left so they sit flush against each other.
 */
export class CloseGapsCommand extends Command {
	private savedState: TimelineTrack[] | null = null;

	execute(): void {
		const editor = EditorCore.getInstance();
		this.savedState = editor.timeline.getTracks();

		const updatedTracks = this.savedState.map((track) => {
			if (track.elements.length <= 1) return track;

			const sorted = [...track.elements].sort(
				(a, b) => a.startTime - b.startTime,
			);

			let cursor = sorted[0].startTime;
			const rippled = sorted.map((el) => {
				const updated = { ...el, startTime: cursor };
				cursor += el.duration;
				return updated;
			});

			return { ...track, elements: rippled } as TimelineTrack;
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
