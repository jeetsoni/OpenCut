"use client";

import {
	useRef,
	useEffect,
	useState,
	useCallback,
	type MouseEvent,
	type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/ui";
import { useEditor } from "@/hooks/use-editor";
import { useWizardStore } from "@/stores/wizard-store";
import type { RemovedSegmentRecord } from "@/stores/wizard-store";
import { Play, Pause, RotateCcw } from "lucide-react";

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

interface CutMarkerPanelProps {
	segment: RemovedSegmentRecord;
	onRestore: (elementId: string) => void;
	onPreview: (time: number) => void;
}

function CutMarkerPanel({ segment, onRestore, onPreview }: CutMarkerPanelProps) {
	return (
		<div
			className={cn(
				"rounded-lg border p-3 text-sm transition-colors",
				segment.isRestored
					? "border-primary/30 bg-primary/5"
					: "border-border bg-card",
			)}
		>
			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="text-foreground font-medium">{segment.label}</p>
					<p className="text-muted-foreground text-xs mt-0.5">
						{segment.isRestored ? "Will be restored" : "Removed segment"}
					</p>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<button
						type="button"
						onClick={() => onPreview(Math.max(0, segment.startTime - 1))}
						className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
					>
						<Play className="size-3" />
						Preview
					</button>
					<button
						type="button"
						onClick={() => onRestore(segment.elementId)}
						className={cn(
							"rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
							segment.isRestored
								? "bg-primary/15 text-primary hover:bg-primary/20"
								: "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
						)}
					>
						{segment.isRestored ? "Restored" : "Restore"}
					</button>
				</div>
			</div>
		</div>
	);
}

export function StepReviewCuts() {
	const editor = useEditor();
	const {
		removedSegments,
		preProcessingTracks,
		toggleSegmentRestored,
		restoreAllSegments,
		setStep,
	} = useWizardStore();

	const videoRef = useRef<HTMLVideoElement>(null);
	const scrubberRef = useRef<HTMLDivElement>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [videoSrc, setVideoSrc] = useState<string | null>(null);
	const [videoMissing, setVideoMissing] = useState(false);
	const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
	const [isPreviewingCut, setIsPreviewingCut] = useState(false);
	const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const blobUrlRef = useRef<string | null>(null);

	// Create blob URL from the uploaded file
	useEffect(() => {
		const assets = editor.media.getAssets().filter((a) => a.type === "video");
		if (assets.length === 0) {
			setVideoMissing(true);
			return;
		}

		const file = assets[0].file;
		const url = URL.createObjectURL(file);
		blobUrlRef.current = url;
		setVideoSrc(url);

		return () => {
			URL.revokeObjectURL(url);
			blobUrlRef.current = null;
		};
	}, [editor]);

	// Clean up preview timer on unmount
	useEffect(() => {
		return () => {
			if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
		};
	}, []);

	const handleSeek = useCallback((time: number) => {
		const video = videoRef.current;
		if (!video) return;
		video.currentTime = time;
		setCurrentTime(time);
	}, []);

	// Auto-skip removed segments during normal playback.
	// Temporarily disabled when the user clicks "Preview" on a cut.
	const handleTimeUpdate = useCallback(() => {
		const t = videoRef.current?.currentTime ?? 0;
		setCurrentTime(t);

		if (!isPreviewingCut) {
			for (const seg of removedSegments) {
				if (
					!seg.isRestored &&
					t >= seg.startTime &&
					t < seg.startTime + seg.duration
				) {
					if (videoRef.current) {
						videoRef.current.currentTime = seg.startTime + seg.duration;
					}
					break;
				}
			}
		}
	}, [removedSegments, isPreviewingCut]);

	// Preview a cut: seek just before the removed segment and play the raw clip
	// for ~5 s so the user can decide whether to restore it.
	const handlePreviewCut = useCallback(
		(startTime: number) => {
			if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
			setIsPreviewingCut(true);
			handleSeek(Math.max(0, startTime - 1));
			void videoRef.current?.play();
			// Re-enable auto-skip after 6 s (plenty of time to watch the cut)
			previewTimerRef.current = setTimeout(
				() => setIsPreviewingCut(false),
				6000,
			);
		},
		[handleSeek],
	);

	const togglePlay = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		if (isPlaying) {
			video.pause();
		} else {
			void video.play();
		}
	}, [isPlaying]);

	const seekFromScrubberEvent = useCallback(
		(clientX: number) => {
			const rect = scrubberRef.current?.getBoundingClientRect();
			if (!rect || duration === 0) return;
			const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
			handleSeek(pct * duration);
		},
		[duration, handleSeek],
	);

	const handleScrubberClick = useCallback(
		(e: MouseEvent<HTMLDivElement>) => {
			seekFromScrubberEvent(e.clientX);
		},
		[seekFromScrubberEvent],
	);

	const handleScrubberKeyDown = useCallback(
		(e: KeyboardEvent<HTMLDivElement>) => {
			if (e.key === "ArrowLeft") handleSeek(Math.max(0, currentTime - 5));
			if (e.key === "ArrowRight") handleSeek(Math.min(duration, currentTime + 5));
		},
		[currentTime, duration, handleSeek],
	);

	const handleContinue = () => {
		const restoredSegments = removedSegments.filter((s) => s.isRestored);

		if (restoredSegments.length > 0 && preProcessingTracks) {
			const currentTracks = editor.timeline.getTracks();
			const preMainTrack = preProcessingTracks.find((t) => t.isMain);

			if (preMainTrack) {
				const restoredTracks = currentTracks.map((t) =>
					t.isMain ? preMainTrack : t,
				);
				editor.timeline.updateTracks(restoredTracks);
			}
		}

		setStep(3);
	};

	const totalRemovedTime = removedSegments.reduce(
		(sum, s) => sum + s.duration,
		0,
	);
	const restoredCount = removedSegments.filter((s) => s.isRestored).length;

	return (
		<div className="flex h-full flex-col items-center px-6 py-10">
			<div className="w-full max-w-2xl">
				<div className="mb-8 text-center">
					<h1 className="text-foreground text-3xl font-bold tracking-tight">
						Review your edits
					</h1>
					{removedSegments.length > 0 ? (
						<>
							<p className="text-muted-foreground mt-2 text-base">
								{removedSegments.length} segment
								{removedSegments.length !== 1 ? "s" : ""} removed —{" "}
								{totalRemovedTime.toFixed(1)}s of silences and retakes cut.
							</p>
							<p className="text-muted-foreground mt-1 text-sm">
								Playing your final edited video. Click{" "}
								<span className="text-foreground font-medium">Preview</span> on a
								segment to watch what was removed.
							</p>
						</>
					) : (
						<p className="text-muted-foreground mt-2 text-base">
							Your video looks clean — nothing was removed.
						</p>
					)}
				</div>

				{/* Video player */}
				<div className="rounded-xl border border-border bg-black overflow-hidden">
					{isPreviewingCut && (
						<div className="bg-amber-500/15 text-amber-400 text-xs text-center py-1 px-3">
							Previewing removed segment — auto-skip paused
						</div>
					)}
					{videoSrc ? (
						// biome-ignore lint/a11y/useMediaCaption: user-uploaded video, no captions available at this stage
						<video
							ref={videoRef}
							src={videoSrc}
							className="w-full max-h-64 object-contain"
							onTimeUpdate={handleTimeUpdate}
							onDurationChange={() =>
								setDuration(videoRef.current?.duration ?? 0)
							}
							onPlay={() => setIsPlaying(true)}
							onPause={() => setIsPlaying(false)}
							onEnded={() => setIsPlaying(false)}
						/>
					) : videoMissing ? (
						<div className="flex h-40 flex-col items-center justify-center gap-3 px-6 text-center">
							<p className="text-muted-foreground text-sm">
								Video preview unavailable — the file was cleared when the page reloaded.
							</p>
							<button
								type="button"
								onClick={() => setStep(1)}
								className="text-primary hover:text-primary/80 text-sm font-medium transition-colors"
							>
								Go back to re-upload
							</button>
						</div>
					) : (
						<div className="flex h-40 items-center justify-center">
							<p className="text-muted-foreground text-sm">Loading video...</p>
						</div>
					)}

					{/* Controls */}
					<div className="bg-black/80 px-4 py-3">
						{/* Scrubber with cut markers */}
						<div
							ref={scrubberRef}
							role="slider"
							aria-label="Video scrubber"
							aria-valuemin={0}
							aria-valuemax={duration}
							aria-valuenow={currentTime}
							tabIndex={0}
							className="relative mb-2 h-2 cursor-pointer rounded-full bg-white/20"
							onClick={handleScrubberClick}
							onKeyDown={handleScrubberKeyDown}
						>
							{/* Playback progress */}
							<div
								className="absolute inset-y-0 left-0 rounded-full bg-white/70 transition-none"
								style={{
									width:
										duration > 0
											? `${(currentTime / duration) * 100}%`
											: "0%",
								}}
							/>

							{/* Cut markers */}
							{duration > 0 &&
								removedSegments.map((seg) => {
									const leftPct = (seg.startTime / duration) * 100;
									const widthPct = (seg.duration / duration) * 100;
									return (
										<button
											key={seg.elementId}
											type="button"
											aria-label={`Cut at ${seg.label}`}
											onClick={(e) => {
												e.stopPropagation();
												setSelectedSegmentId(
													selectedSegmentId === seg.elementId
														? null
														: seg.elementId,
												);
											}}
											className={cn(
												"absolute inset-y-0 rounded-sm transition-colors",
												seg.isRestored
													? "bg-primary/70"
													: "bg-destructive/70 hover:bg-destructive/90",
											)}
											style={{
												left: `${leftPct}%`,
												width: `${Math.max(widthPct, 0.5)}%`,
											}}
										/>
									);
								})}
						</div>

						<div className="flex items-center justify-between">
							<button
								type="button"
								onClick={togglePlay}
								aria-label={isPlaying ? "Pause" : "Play"}
								className="text-white/80 hover:text-white transition-colors"
							>
								{isPlaying ? (
									<Pause className="size-4" />
								) : (
									<Play className="size-4" />
								)}
							</button>
							<span className="text-white/60 text-xs">
								{formatTime(currentTime)} / {formatTime(duration)}
							</span>
						</div>
					</div>
				</div>

				{/* Selected cut detail panel */}
				{selectedSegmentId &&
					(() => {
						const seg = removedSegments.find(
							(s) => s.elementId === selectedSegmentId,
						);
						if (!seg) return null;
						return (
							<div className="mt-3">
								<CutMarkerPanel
									segment={seg}
									onRestore={(id) => toggleSegmentRestored(id)}
									onPreview={(time) => handlePreviewCut(time)}
								/>
							</div>
						);
					})()}

				{/* Removed segments list */}
				{removedSegments.length > 0 && (
					<div className="mt-6">
						<div className="mb-3 flex items-center justify-between">
							<p className="text-foreground text-sm font-semibold">
								Removed segments
							</p>
							<div className="flex gap-2">
								{restoredCount > 0 && (
									<button
										type="button"
										onClick={() =>
											useWizardStore
												.getState()
												.setRemovedSegments(
													removedSegments.map((s) => ({
														...s,
														isRestored: false,
													})),
												)
										}
										className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
									>
										<RotateCcw className="size-3" />
										Undo all restores
									</button>
								)}
								{restoredCount < removedSegments.length && (
									<button
										type="button"
										onClick={restoreAllSegments}
										className="text-primary hover:text-primary/80 text-xs font-medium transition-colors"
									>
										Restore all
									</button>
								)}
							</div>
						</div>
						<div className="flex flex-col gap-2">
							{removedSegments.map((seg) => (
								<CutMarkerPanel
									key={seg.elementId}
									segment={seg}
									onRestore={(id) => {
										toggleSegmentRestored(id);
										setSelectedSegmentId(id);
									}}
									onPreview={(time) => {
										handlePreviewCut(time);
										setSelectedSegmentId(seg.elementId);
									}}
								/>
							))}
						</div>
					</div>
				)}

				<div className="mt-8 flex items-center justify-between">
					<button
						type="button"
						onClick={() => setStep(1)}
						className="text-muted-foreground hover:text-foreground text-sm transition-colors"
					>
						Back
					</button>
					<Button onClick={handleContinue} size="lg">
						Looks good, continue
					</Button>
				</div>
			</div>
		</div>
	);
}
