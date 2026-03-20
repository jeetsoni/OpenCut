import { useEffect, useRef, useState } from "react";
import type WaveSurferType from "wavesurfer.js";

interface AudioWaveformProps {
	audioUrl?: string;
	audioBuffer?: AudioBuffer;
	height?: number;
	className?: string;
}

export function AudioWaveform({
	audioUrl,
	audioBuffer,
	height = 32,
	className = "",
}: AudioWaveformProps) {
	const waveformRef = useRef<HTMLDivElement>(null);
	const wavesurfer = useRef<WaveSurferType | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(false);

	useEffect(() => {
		let mounted = true;
		const ws = wavesurfer.current;

		const initWaveSurfer = async () => {
			if (!waveformRef.current || (!audioUrl && !audioBuffer)) return;

			try {
				const { default: WaveSurfer } = await import("wavesurfer.js");

				if (!mounted) return;

				if (ws) {
					wavesurfer.current = null;
				}

				const newWaveSurfer = WaveSurfer.create({
					container: waveformRef.current,
					waveColor: "rgba(255, 255, 255, 0.6)",
					progressColor: "rgba(255, 255, 255, 0.9)",
					cursorColor: "transparent",
					barWidth: 2,
					barGap: 1,
					height,
					normalize: true,
					interact: false,
				});

				if (mounted) {
					wavesurfer.current = newWaveSurfer;
				} else {
					try {
						newWaveSurfer.destroy();
					} catch {}
					return;
				}

				newWaveSurfer.on("ready", () => {
					if (mounted) {
						setIsLoading(false);
						setError(false);
					}
				});

				newWaveSurfer.on("error", (err) => {
					if (mounted) {
						console.error("WaveSurfer error:", err);
						setError(true);
						setIsLoading(false);
					}
				});

				if (audioBuffer) {
					// Use loadDecodedBuffer when an AudioBuffer is provided directly —
					// passing an empty URL to load() causes a failed fetch and fires an error.
					newWaveSurfer.loadDecodedBuffer(audioBuffer);
				} else if (audioUrl) {
					await newWaveSurfer.load(audioUrl);
				}
			} catch (err) {
				if (mounted) {
					console.error("Failed to initialize WaveSurfer:", err);
					setError(true);
					setIsLoading(false);
				}
			}
		};

		if (ws) {
			const wsToDestroy = ws;
			wavesurfer.current = null;

			requestAnimationFrame(() => {
				try {
					wsToDestroy.destroy();
				} catch {}
				if (mounted) {
					initWaveSurfer();
				}
			});
		} else {
			initWaveSurfer();
		}

		return () => {
			mounted = false;

			const wsToDestroy = wavesurfer.current;

			wavesurfer.current = null;

			if (wsToDestroy) {
				requestAnimationFrame(() => {
					try {
						wsToDestroy.destroy();
					} catch {}
				});
			}
		};
	}, [audioUrl, audioBuffer, height]);

	if (error) {
		return (
			<div
				className={`flex items-center justify-center ${className}`}
				style={{ height }}
			>
				<span className="text-foreground/60 text-xs">Audio unavailable</span>
			</div>
		);
	}

	return (
		<div className={`relative ${className}`}>
			{isLoading && (
				<div className="absolute inset-0 flex items-center justify-center">
					<span className="text-foreground/60 text-xs">Loading...</span>
				</div>
			)}
			<div
				ref={waveformRef}
				className={`w-full ${isLoading ? "opacity-0" : "opacity-100"}`}
				style={{ height }}
			/>
		</div>
	);
}

export default AudioWaveform;
