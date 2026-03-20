import { usePlaybackTime } from "@/hooks/use-playback-time";
import { getElementLocalTime } from "@/lib/animation";
import { TIME_EPSILON_SECONDS } from "@/constants/animation-constants";

export function useElementPlayhead({
	startTime,
	duration,
}: {
	startTime: number;
	duration: number;
}) {
	const playheadTime = usePlaybackTime();
	const localTime = getElementLocalTime({
		timelineTime: playheadTime,
		elementStartTime: startTime,
		elementDuration: duration,
	});
	const isPlayheadWithinElementRange =
		playheadTime >= startTime - TIME_EPSILON_SECONDS &&
		playheadTime <= startTime + duration + TIME_EPSILON_SECONDS;

	return { localTime, isPlayheadWithinElementRange };
}
