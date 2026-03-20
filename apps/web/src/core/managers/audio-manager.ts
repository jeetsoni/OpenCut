import type { EditorCore } from "@/core";
import type { TimelineTrack } from "@/types/timeline";
import type { MediaAsset } from "@/types/assets";
import { createAudioContext } from "@/lib/media/audio";
import { canTracktHaveAudio } from "@/lib/timeline";
import { canElementHaveAudio } from "@/lib/timeline/element-utils";
import { mediaSupportsAudio } from "@/lib/media/media-utils";
import {
	Input,
	ALL_FORMATS,
	BlobSource,
	AudioBufferSink,
} from "mediabunny";

interface ScheduledClip {
	node: AudioBufferSourceNode;
	gain: GainNode;
}

interface AudioClip {
	/** Unique key for buffer caching (mediaAsset.id or element.id for library audio) */
	cacheKey: string;
	file: File | null;
	/** For library audio fetched via URL */
	sourceUrl?: string;
	startTime: number;
	duration: number;
	trimStart: number;
	muted: boolean;
	volume: number;
}

export class AudioManager {
	private audioContext: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	private scheduledClips: ScheduledClip[] = [];
	private playbackSessionId = 0;
	private lastIsPlaying = false;
	private lastVolume = 1;
	private unsubscribers: Array<() => void> = [];
	/** Decoded AudioBuffers cached by cacheKey — avoids re-decoding on seek/replay. */
	private bufferCache = new Map<string, AudioBuffer>();

	constructor(private editor: EditorCore) {
		this.lastVolume = this.editor.playback.getVolume();

		this.unsubscribers.push(
			this.editor.playback.subscribe(this.handlePlaybackChange),
			this.editor.timeline.subscribe(this.handleStructuralChange),
			this.editor.media.subscribe(this.handleStructuralChange),
		);
		if (typeof window !== "undefined") {
			window.addEventListener("playback-seek", this.handleSeek);
		}
	}

	dispose(): void {
		this.stopAllNodes();
		for (const unsub of this.unsubscribers) {
			unsub();
		}
		this.unsubscribers = [];
		if (typeof window !== "undefined") {
			window.removeEventListener("playback-seek", this.handleSeek);
		}
		this.bufferCache.clear();
		if (this.audioContext) {
			void this.audioContext.close();
			this.audioContext = null;
			this.masterGain = null;
		}
	}

	private handlePlaybackChange = (): void => {
		const isPlaying = this.editor.playback.getIsPlaying();
		const volume = this.editor.playback.getVolume();

		if (volume !== this.lastVolume) {
			this.lastVolume = volume;
			this.updateGain();
		}

		if (isPlaying !== this.lastIsPlaying) {
			this.lastIsPlaying = isPlaying;
			if (isPlaying) {
				void this.startPlayback({
					time: this.editor.playback.getCurrentTime(),
				});
			} else {
				this.stopAllNodes();
			}
		}
	};

	private handleSeek = (event: Event): void => {
		const detail = (event as CustomEvent<{ time: number }>).detail;
		if (!detail) return;

		if (this.editor.playback.getIsScrubbing()) {
			this.stopAllNodes();
			return;
		}

		if (this.editor.playback.getIsPlaying()) {
			void this.startPlayback({ time: detail.time });
			return;
		}

		this.stopAllNodes();
	};

	private handleStructuralChange = (): void => {
		// Clear the buffer cache when the timeline or media changes so that
		// any replaced or updated clips get re-decoded next play.
		this.bufferCache.clear();

		if (!this.editor.playback.getIsPlaying()) return;
		void this.startPlayback({ time: this.editor.playback.getCurrentTime() });
	};

	private ensureAudioContext(): AudioContext | null {
		if (this.audioContext) return this.audioContext;
		if (typeof window === "undefined") return null;

		this.audioContext = createAudioContext();
		this.masterGain = this.audioContext.createGain();
		this.masterGain.gain.value = this.lastVolume;
		this.masterGain.connect(this.audioContext.destination);
		return this.audioContext;
	}

	private updateGain(): void {
		if (!this.masterGain) return;
		this.masterGain.gain.value = this.lastVolume;
	}

	private stopAllNodes(): void {
		this.playbackSessionId++;
		for (const { node, gain } of this.scheduledClips) {
			try {
				node.stop();
			} catch {}
			node.disconnect();
			gain.disconnect();
		}
		this.scheduledClips = [];
	}

	// ---------------------------------------------------------------------------
	// Collect AudioClip descriptors from the current timeline state
	// ---------------------------------------------------------------------------

	private collectClips(): AudioClip[] {
		const tracks = this.editor.timeline.getTracks();
		const mediaAssets = this.editor.media.getAssets();
		const mediaMap = new Map<string, MediaAsset>(
			mediaAssets.map((a) => [a.id, a]),
		);
		const clips: AudioClip[] = [];

		for (const track of tracks) {
			const isTrackMuted = canTracktHaveAudio(track) && track.muted;

			for (const element of track.elements) {
				if (!canElementHaveAudio(element)) continue;
				if (element.duration <= 0) continue;

				const isElementMuted = "muted" in element ? (element.muted ?? false) : false;
				const muted = isTrackMuted || isElementMuted;

				if (element.type === "audio") {
					if (element.sourceType === "upload") {
						const asset = mediaMap.get(element.mediaId);
						if (!asset) continue;
						clips.push({
							cacheKey: asset.id,
							file: asset.file,
							startTime: element.startTime,
							duration: element.duration,
							trimStart: element.trimStart,
							muted,
							volume: element.volume ?? 1,
						});
					} else {
						// Library audio — fetch from URL
						clips.push({
							cacheKey: element.id,
							file: null,
							sourceUrl: element.sourceUrl,
							startTime: element.startTime,
							duration: element.duration,
							trimStart: element.trimStart,
							muted,
							volume: element.volume ?? 1,
						});
					}
					continue;
				}

				if (element.type === "video") {
					const asset = mediaMap.get(element.mediaId);
					if (!asset || !mediaSupportsAudio({ media: asset })) continue;
					clips.push({
						cacheKey: asset.id,
						file: asset.file,
						startTime: element.startTime,
						duration: element.duration,
						trimStart: element.trimStart,
						muted,
						volume: 1,
					});
				}
			}
		}

		return clips;
	}

	// ---------------------------------------------------------------------------
	// Decode a single clip's file to an AudioBuffer (with caching)
	// ---------------------------------------------------------------------------

	private async decodeClip(
		clip: AudioClip,
		audioContext: AudioContext,
	): Promise<AudioBuffer | null> {
		const cached = this.bufferCache.get(clip.cacheKey);
		if (cached) return cached;

		try {
			let buffer: AudioBuffer | null = null;

			if (clip.file) {
				// Primary path: Web Audio API decodeAudioData.
				// Works for most audio files and for video containers on modern browsers.
				try {
					const arrayBuffer = await clip.file.arrayBuffer();
					buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
				} catch {
					// Fallback: use mediabunny to demux and decode (e.g. for some MP4 files
					// whose audio track can't be decoded by decodeAudioData directly).
					buffer = await this.decodeViaMediabunny(clip.file, audioContext);
				}
			} else if (clip.sourceUrl) {
				// Library audio: fetch then decode
				const response = await fetch(clip.sourceUrl);
				if (!response.ok) return null;
				const arrayBuffer = await response.arrayBuffer();
				buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
			}

			if (buffer) {
				this.bufferCache.set(clip.cacheKey, buffer);
			}
			return buffer;
		} catch (err) {
			console.warn("[AudioManager] Failed to decode clip:", clip.cacheKey, err);
			return null;
		}
	}

	private async decodeViaMediabunny(
		file: File,
		audioContext: AudioContext,
	): Promise<AudioBuffer | null> {
		const MAX_CHANNELS = 2;
		const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

		try {
			const audioTrack = await input.getPrimaryAudioTrack();
			if (!audioTrack) return null;

			const sink = new AudioBufferSink(audioTrack);
			const chunks: AudioBuffer[] = [];
			let totalSamples = 0;

			for await (const { buffer } of sink.buffers(0)) {
				chunks.push(buffer);
				totalSamples += buffer.length;
			}

			if (chunks.length === 0) return null;

			const nativeSampleRate = chunks[0].sampleRate;
			const numChannels = Math.min(MAX_CHANNELS, chunks[0].numberOfChannels);
			const targetSampleRate = audioContext.sampleRate;

			// Stitch chunks into one contiguous buffer
			const nativeChannels = Array.from(
				{ length: numChannels },
				() => new Float32Array(totalSamples),
			);
			let offset = 0;
			for (const chunk of chunks) {
				for (let ch = 0; ch < numChannels; ch++) {
					const src = chunk.getChannelData(Math.min(ch, chunk.numberOfChannels - 1));
					nativeChannels[ch].set(src, offset);
				}
				offset += chunk.length;
			}

			// Resample to the AudioContext's sample rate via OfflineAudioContext
			const outputSamples = Math.ceil(totalSamples * (targetSampleRate / nativeSampleRate));
			const offline = new OfflineAudioContext(numChannels, outputSamples, targetSampleRate);
			const nativeBuffer = audioContext.createBuffer(numChannels, totalSamples, nativeSampleRate);
			for (let ch = 0; ch < numChannels; ch++) {
				nativeBuffer.copyToChannel(nativeChannels[ch], ch);
			}
			const src = offline.createBufferSource();
			src.buffer = nativeBuffer;
			src.connect(offline.destination);
			src.start(0);
			return await offline.startRendering();
		} catch (err) {
			console.warn("[AudioManager] mediabunny decode failed:", err);
			return null;
		} finally {
			input.dispose();
		}
	}

	// ---------------------------------------------------------------------------
	// Main playback scheduling
	// ---------------------------------------------------------------------------

	private async startPlayback({ time }: { time: number }): Promise<void> {
		const audioContext = this.ensureAudioContext();
		if (!audioContext) return;

		this.stopAllNodes();
		const sessionId = this.playbackSessionId;

		const duration = this.editor.timeline.getTotalDuration();
		if (duration <= 0) return;

		if (audioContext.state === "suspended") {
			await audioContext.resume();
		}

		const clips = this.collectClips();

		// Decode all clips in parallel. Cached clips return immediately;
		// uncached ones decode once and are stored for future seeks/plays.
		const decoded = await Promise.all(
			clips.map(async (clip) => {
				const buffer = await this.decodeClip(clip, audioContext);
				return buffer ? { clip, buffer } : null;
			}),
		);

		// Bail if play was stopped or a newer startPlayback call took over.
		if (sessionId !== this.playbackSessionId) return;
		if (!this.editor.playback.getIsPlaying()) return;

		const contextNow = audioContext.currentTime;

		for (const item of decoded) {
			if (!item) continue;
			const { clip, buffer } = item;
			if (clip.muted) continue;

			const clipEnd = clip.startTime + clip.duration;
			if (clipEnd <= time) continue; // entirely in the past

			const playbackOffset = Math.max(0, time - clip.startTime);
			const bufferOffset = clip.trimStart + playbackOffset;
			const remainingDuration = clip.duration - playbackOffset;
			if (remainingDuration <= 0) continue;

			// If the clip hasn't started yet, schedule it in the future.
			const startDelay = Math.max(0, clip.startTime - time);
			const whenToStart = contextNow + startDelay;

			const gain = audioContext.createGain();
			gain.gain.value = clip.volume;
			gain.connect(this.masterGain ?? audioContext.destination);

			const node = audioContext.createBufferSource();
			node.buffer = buffer;
			node.connect(gain);
			node.start(whenToStart, bufferOffset, remainingDuration);

			this.scheduledClips.push({ node, gain });

			node.addEventListener("ended", () => {
				node.disconnect();
				gain.disconnect();
				this.scheduledClips = this.scheduledClips.filter((s) => s.node !== node);
			});
		}
	}
}
