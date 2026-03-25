"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/utils/ui";
import { useEditor } from "@/hooks/use-editor";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useWizardStore } from "@/stores/wizard-store";
import { processMediaAssets } from "@/lib/media/processing";
import { buildElementFromMedia } from "@/lib/timeline/element-utils";
import type { RemovedSegmentRecord } from "@/stores/wizard-store";
import type { TimelineTrack } from "@/types/timeline";
import { CloudUploadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loader2, CheckCircle2, CircleDashed } from "lucide-react";

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

function computeRemovedSegments(
	pre: TimelineTrack[],
	post: TimelineTrack[],
): RemovedSegmentRecord[] {
	const mainPost = post.find((t) => t.isMain);
	if (!mainPost) return [];

	// Build covered media ranges from post-state elements
	const coveredRanges = mainPost.elements
		.map((el) => ({
			start: el.trimStart,
			end: el.trimStart + el.duration,
			trackId: mainPost.id,
		}))
		.sort((a, b) => a.start - b.start);

	if (coveredRanges.length === 0) return [];

	// Find original total duration from pre-state
	const mainPre = pre.find((t) => t.isMain);
	if (!mainPre || mainPre.elements.length === 0) return [];
	const preEl = mainPre.elements[0];
	const mediaEnd = preEl.trimStart + preEl.duration;

	const removed: RemovedSegmentRecord[] = [];
	let cursor = preEl.trimStart;

	for (const range of coveredRanges) {
		if (range.start > cursor + 0.05) {
			const start = cursor;
			const end = range.start;
			removed.push({
				trackId: mainPost.id,
				elementId: `gap-${start.toFixed(3)}`,
				startTime: start,
				duration: end - start,
				label: `${formatTime(start)} – ${formatTime(end)} (${(end - start).toFixed(1)}s)`,
				isRestored: false,
			});
		}
		cursor = Math.max(cursor, range.end);
	}

	if (cursor < mediaEnd - 0.05) {
		removed.push({
			trackId: mainPost.id,
			elementId: `gap-${cursor.toFixed(3)}`,
			startTime: cursor,
			duration: mediaEnd - cursor,
			label: `${formatTime(cursor)} – ${formatTime(mediaEnd)} (${(mediaEnd - cursor).toFixed(1)}s)`,
			isRestored: false,
		});
	}

	return removed;
}

const PROCESSING_STEPS = [
	{ key: "processing-file", label: "Processing video file" },
	{ key: "removing-silence", label: "Removing silence" },
	{ key: "removing-retakes", label: "Removing retakes" },
] as const;

export function StepUpload() {
	const editor = useEditor();
	const {
		uploadPhase,
		uploadMessage,
		setUploadPhase,
		setProcessingSnapshots,
		setRemovedSegments,
		setStep,
	} = useWizardStore();

	const processFiles = async ({ files }: { files: FileList }) => {
		if (!files || files.length === 0) return;

		const activeProject = editor.project.getActive();
		if (!activeProject) return;
		const projectId = activeProject.metadata.id;

		try {
			setUploadPhase("processing-file", "Processing video file...");

			const [asset] = await processMediaAssets({
				files,
				onProgress: () => {},
			});

			if (!asset) {
				setUploadPhase("error", "Failed to process file");
				return;
			}

			await editor.media.addMediaAsset({ projectId, asset });

			// addMediaAsset generates a new UUID internally — get the stored asset to
			// use its real ID; without this, mediaId is undefined and audio processing skips.
			const storedAsset = editor.media
				.getAssets()
				.find((a) => a.file === asset.file);
			if (!storedAsset) {
				setUploadPhase("error", "Failed to register media asset");
				return;
			}

			const element = buildElementFromMedia({
				mediaId: storedAsset.id,
				mediaType: storedAsset.type,
				name: storedAsset.name,
				duration: storedAsset.duration ?? 10,
				startTime: 0,
			});
			editor.timeline.insertElement({ element, placement: { mode: "auto" } });

			// Snapshot state before processing
			const preProcessingTracks = editor.timeline.getTracks();

			// Collect all video/audio elements from given tracks
			const getAllElements = (tracks: typeof preProcessingTracks) =>
				tracks.flatMap((t) =>
					t.elements
						.filter((e) => e.type === "video" || e.type === "audio")
						.map((e) => ({ trackId: t.id, elementId: e.id })),
				);

			// Remove silence FIRST
			setUploadPhase("removing-silence", "Removing silence...");
			await editor.timeline.removeSilence({
				elements: getAllElements(preProcessingTracks),
			});

			// Remove retakes SECOND — after silence is gone
			setUploadPhase("removing-retakes", "Transcribing audio for retake detection...");
			const afterSilenceTracks = editor.timeline.getTracks();
			await editor.timeline.removeRetakes({
				elements: getAllElements(afterSilenceTracks),
				onProgress: (p) => setUploadPhase("removing-retakes", p.message),
			});

			const postProcessingTracks = editor.timeline.getTracks();

			const removed = computeRemovedSegments(
				preProcessingTracks,
				postProcessingTracks,
			);

			setProcessingSnapshots(preProcessingTracks, postProcessingTracks);
			setRemovedSegments(removed);
			setUploadPhase("done", "Ready");
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Processing failed";
			setUploadPhase("error", msg);
		}
	};

	const { isDragOver, dragProps, openFilePicker, fileInputProps } =
		useFileUpload({
			accept: "video/*",
			multiple: false,
			onFilesSelected: (files) => void processFiles({ files }),
		});

	const getStepStatus = (stepKey: string) => {
		const phases = [
			"processing-file",
			"removing-silence",
			"removing-retakes",
			"done",
		];
		const currentIndex = phases.indexOf(uploadPhase);
		const stepIndex = phases.indexOf(stepKey);

		if (uploadPhase === "done") return "done";
		if (stepIndex < currentIndex) return "done";
		if (stepIndex === currentIndex) return "active";
		return "pending";
	};

	return (
		<div className="flex h-full flex-col items-center justify-center px-6 py-12">
			<input {...fileInputProps} />
			<div className="w-full max-w-xl">
				<div className="mb-10 text-center">
					<h1 className="text-foreground text-3xl font-bold tracking-tight">
						Upload your video
					</h1>
					<p className="text-muted-foreground mt-2 text-base">
						We'll automatically remove silences and retakes in the background.
					</p>
				</div>

				{uploadPhase === "idle" && (
					<button
						type="button"
						onClick={openFilePicker}
						{...dragProps}
						className={cn(
							"flex w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-8 py-16 transition-colors",
							isDragOver
								? "border-primary bg-primary/5"
								: "border-border hover:border-muted-foreground/40 hover:bg-muted/20",
						)}
					>
						<div className="bg-muted flex size-14 items-center justify-center rounded-full">
							<HugeiconsIcon
								icon={CloudUploadIcon}
								className="text-muted-foreground size-7"
							/>
						</div>
						<div className="text-center">
							<p className="text-foreground text-base font-medium">
								Drop your video here
							</p>
							<p className="text-muted-foreground mt-1 text-sm">
								or click to browse — MP4, MOV, WebM supported
							</p>
						</div>
					</button>
				)}

				{uploadPhase !== "idle" && (
					<div className="rounded-2xl border border-border bg-card p-6">
						<div className="flex flex-col gap-4">
							{PROCESSING_STEPS.map((step) => {
								const status = getStepStatus(step.key);
								return (
									<div
										key={step.key}
										className="flex items-center gap-3"
									>
										{status === "done" ? (
											<CheckCircle2 className="text-primary size-5 shrink-0" />
										) : status === "active" ? (
											<Loader2 className="text-primary size-5 shrink-0 animate-spin" />
										) : (
											<CircleDashed className="text-muted-foreground/40 size-5 shrink-0" />
										)}
										<span
											className={cn(
												"text-sm font-medium",
												status === "pending" && "text-muted-foreground/50",
												status === "active" && "text-foreground",
												status === "done" && "text-muted-foreground",
											)}
										>
											{status === "active"
												? uploadMessage || step.label
												: step.label}
										</span>
									</div>
								);
							})}

							{uploadPhase === "done" && (
								<div className="mt-1 flex items-center gap-3">
									<CheckCircle2 className="text-primary size-5 shrink-0" />
									<span className="text-foreground text-sm font-semibold">
										Ready to review
									</span>
								</div>
							)}

							{uploadPhase === "error" && (
								<p className="text-destructive mt-2 text-sm">{uploadMessage}</p>
							)}
						</div>
					</div>
				)}

				<div className="mt-8 flex items-center justify-between">
					<button
						type="button"
						onClick={() => {
							useWizardStore.getState().setStep(0);
						}}
						className="text-muted-foreground hover:text-foreground text-sm transition-colors"
					>
						Back
					</button>
					<Button
						onClick={() => setStep(2)}
						disabled={uploadPhase !== "done"}
						size="lg"
					>
						Next: Review cuts
					</Button>
				</div>
			</div>
		</div>
	);
}
