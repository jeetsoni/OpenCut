import { useCallback, useMemo, useSyncExternalStore } from "react";
import { EditorCore } from "@/core";

/**
 * Returns the current playback time, re-rendering only on time changes.
 * Use this instead of `useEditor().playback.getCurrentTime()` in components
 * that display the current time — it avoids triggering full useEditor()
 * re-renders (which cascade across all editor components every frame).
 */
export function usePlaybackTime(): number {
	const editor = useMemo(() => EditorCore.getInstance(), []);

	const subscribe = useCallback(
		(onStoreChange: () => void) =>
			editor.playback.subscribeToTime(onStoreChange),
		[editor],
	);

	const getSnapshot = useCallback(
		() => editor.playback.getCurrentTime(),
		[editor],
	);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
