/**
 * Browser-based silence detection using Web Audio API.
 *
 * Inspired by remotion's `getSilentParts` but runs entirely client-side
 * by analysing decoded PCM samples instead of shelling out to FFmpeg.
 */

export interface AudioSegment {
	startTime: number;
	endTime: number;
}

export interface SilenceDetectionResult {
	silentParts: AudioSegment[];
	audibleParts: AudioSegment[];
	durationInSeconds: number;
}

export interface SilenceDetectionOptions {
	/** Threshold in dB below which audio is considered silent. Default -30 */
	noiseThresholdInDecibels?: number;
	/** Minimum duration (seconds) for a silent segment to count. Default 0.3 */
	minSilenceDuration?: number;
}

/**
 * Detect silent and audible segments from mono Float32 PCM samples.
 */
export function detectSilence({
	samples,
	sampleRate,
	noiseThresholdInDecibels = -30,
	minSilenceDuration = 0.3,
}: {
	samples: Float32Array;
	sampleRate: number;
} & SilenceDetectionOptions): SilenceDetectionResult {
	const durationInSeconds = samples.length / sampleRate;
	// Convert dB threshold to linear amplitude
	const threshold = 10 ** (noiseThresholdInDecibels / 20);

	// Analyse in small windows to avoid per-sample noise
	const windowSize = Math.floor(sampleRate * 0.01); // 10ms windows
	const silentWindows: boolean[] = [];

	for (let i = 0; i < samples.length; i += windowSize) {
		const end = Math.min(i + windowSize, samples.length);
		let rms = 0;
		for (let j = i; j < end; j++) {
			rms += samples[j] * samples[j];
		}
		rms = Math.sqrt(rms / (end - i));
		silentWindows.push(rms < threshold);
	}

	// Build raw silent segments from consecutive silent windows
	const windowDuration = windowSize / sampleRate;
	const rawSilent: AudioSegment[] = [];
	let segStart: number | null = null;

	for (let i = 0; i < silentWindows.length; i++) {
		if (silentWindows[i]) {
			if (segStart === null) segStart = i * windowDuration;
		} else {
			if (segStart !== null) {
				rawSilent.push({ startTime: segStart, endTime: i * windowDuration });
				segStart = null;
			}
		}
	}
	if (segStart !== null) {
		rawSilent.push({ startTime: segStart, endTime: durationInSeconds });
	}

	// Filter by minimum duration
	const silentParts = rawSilent.filter(
		(s) => s.endTime - s.startTime >= minSilenceDuration,
	);

	// Derive audible parts as the inverse
	const audibleParts: AudioSegment[] = [];
	let cursor = 0;
	for (const silent of silentParts) {
		if (silent.startTime > cursor) {
			audibleParts.push({ startTime: cursor, endTime: silent.startTime });
		}
		cursor = silent.endTime;
	}
	if (cursor < durationInSeconds) {
		audibleParts.push({ startTime: cursor, endTime: durationInSeconds });
	}

	return { silentParts, audibleParts, durationInSeconds };
}
