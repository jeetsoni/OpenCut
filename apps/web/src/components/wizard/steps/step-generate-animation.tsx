"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/ui";
import { useEditor } from "@/hooks/use-editor";
import { useWizardStore } from "@/stores/wizard-store";
import { useSceneStore } from "@/stores/scene-store";
import { usePreviewStore } from "@/stores/preview-store";
import { getAIProviderConfig } from "@/lib/ai-provider";
import { createTimelineAudioBuffer } from "@/lib/media/audio";
import { generateTranscript } from "@/lib/transcription/generate-transcript";
import {
	getProjectTranscript,
	setProjectTranscript,
} from "@/lib/transcription/transcript-store";
import { detectSceneBoundaries } from "@/lib/scene-planner/detect-boundaries";
import {
	getProjectBoundaries,
	setProjectBoundaries,
} from "@/lib/scene-planner/boundaries-store";
import { generateSceneDirection } from "@/lib/scene-planner/generate-scene-direction";
import { setSceneDirection } from "@/lib/scene-planner/scene-direction-store";
import { generateSceneRemotionCode } from "@/lib/remotion-renderer/generate-scene-code";
import { setSceneRemotionCode } from "@/lib/remotion-renderer/scene-code-store";
import type { PlannedScene } from "@/lib/scene-planner/schema";
import { CheckCircle2, Loader2, CircleDashed, AlertCircle } from "lucide-react";

// Lazy-load the animation overlay (it pulls in Remotion + sucrase)
const AnimationOverlay = dynamic(
	() =>
		import(
			"@/components/editor/panels/preview/animation-overlay"
		).then((m) => m.AnimationOverlay),
	{ ssr: false },
);

type PhaseStatus = "pending" | "active" | "done" | "error";

interface PipelineStep {
	key: string;
	label: string;
	status: PhaseStatus;
	detail?: string;
}

export function StepGenerateAnimation() {
	const editor = useEditor();
	const router = useRouter();
	const { pipelinePhase, pipelineMessage, directionProgress, animationProgress, setPipelinePhase, setDirectionProgress, setAnimationProgress, incrementAnimationProgress } =
		useWizardStore();

	const [error, setError] = useState<string | null>(null);
	const hasStarted = useRef(false);

	const projectId = editor.project.getActive()?.metadata.id;

	// Check API key before starting
	const config = getAIProviderConfig();
	const hasApiKey = Boolean(config?.apiKey);

	const getStepStatus = (key: string): PhaseStatus => {
		const order = [
			"gaps",
			"transcript",
			"boundaries",
			"directions",
			"animations",
			"done",
		];
		const currentIndex = order.indexOf(pipelinePhase);
		const stepIndex = order.indexOf(key);

		if (pipelinePhase === "error") {
			if (stepIndex < currentIndex) return "done";
			if (stepIndex === currentIndex) return "error";
			return "pending";
		}
		if (pipelinePhase === "done") return "done";
		if (stepIndex < currentIndex) return "done";
		if (stepIndex === currentIndex) return "active";
		return "pending";
	};

	const steps: PipelineStep[] = [
		{
			key: "gaps",
			label: "Closing timeline gaps",
			status: getStepStatus("gaps"),
		},
		{
			key: "transcript",
			label: "Generating transcript",
			status: getStepStatus("transcript"),
			detail:
				pipelinePhase === "transcript" ? pipelineMessage : undefined,
		},
		{
			key: "boundaries",
			label: "Detecting scene boundaries",
			status: getStepStatus("boundaries"),
			detail:
				pipelinePhase === "boundaries" ? pipelineMessage : undefined,
		},
		{
			key: "directions",
			label: "Generating scene directions",
			status: getStepStatus("directions"),
			detail:
				directionProgress
					? `${directionProgress.current} / ${directionProgress.total} scenes`
					: undefined,
		},
		{
			key: "animations",
			label: "Generating animation code",
			status: getStepStatus("animations"),
			detail:
				animationProgress
					? `${animationProgress.current} / ${animationProgress.total} scenes`
					: undefined,
		},
	];

	// biome-ignore lint/correctness/useExhaustiveDependencies: runPipeline runs once on mount via hasStarted ref
	useEffect(() => {
		if (!hasApiKey || !projectId || hasStarted.current) return;
		hasStarted.current = true;
		void runPipeline();
	}, [hasApiKey, projectId]);

	const runPipeline = async () => {
		if (!projectId) return;

		try {
			// Phase 1: Close gaps
			setPipelinePhase("gaps", "Closing timeline gaps...");
			editor.timeline.closeGaps();
			editor.timeline.mergeAdjacentElements();

			// Phase 2: Generate transcript
			setPipelinePhase("transcript", "Extracting audio from timeline...");

			let transcript = await getProjectTranscript({ projectId });

			if (!transcript) {
				const tracks = editor.timeline.getTracks();
				const mediaAssets = editor.media.getAssets();
				const duration = editor.timeline.getTotalDuration();

				if (duration === 0) {
					throw new Error("Timeline is empty — add a video first.");
				}

				const audioBuffer = await createTimelineAudioBuffer({
					tracks,
					mediaAssets,
					duration,
				});

				if (!audioBuffer) {
					throw new Error(
						"No audio found in timeline. Add a video with audio first.",
					);
				}

				const length = audioBuffer.length;
				const numChannels = audioBuffer.numberOfChannels;
				const samples = new Float32Array(length);
				for (let i = 0; i < length; i++) {
					let sum = 0;
					for (let ch = 0; ch < numChannels; ch++) {
						sum += audioBuffer.getChannelData(ch)[i];
					}
					samples[i] = sum / numChannels;
				}

				transcript = await generateTranscript({
					samples,
					sampleRate: audioBuffer.sampleRate,
					onProgress: (p) =>
						setPipelinePhase("transcript", p.message),
				});

				await setProjectTranscript({ projectId, transcript });
			}

			// Phase 3: Detect scene boundaries
			setPipelinePhase("boundaries", "Detecting scene boundaries...");

			let boundaries = await getProjectBoundaries({ projectId });

			if (!boundaries) {
				boundaries = await detectSceneBoundaries({
					transcript,
					onProgress: (p) =>
						setPipelinePhase("boundaries", p.message),
				});
				await setProjectBoundaries({ projectId, boundaries });

				// Apply splits to timeline at scene boundary times
				const splitTimes = boundaries.boundaries
					.map((b) => b.startTime)
					.filter((t) => t > 0)
					.sort((a, b) => a - b);

				for (const splitTime of splitTimes) {
					const currentTracks = editor.timeline.getTracks();
					const elementsAtTime = currentTracks.flatMap((track) =>
						track.elements
							.filter(
								(el) =>
									el.startTime < splitTime &&
									el.startTime + el.duration > splitTime,
							)
							.map((el) => ({
								trackId: track.id,
								elementId: el.id,
							})),
					);
					if (elementsAtTime.length > 0) {
						editor.timeline.splitElements({
							elements: elementsAtTime,
							splitTime,
						});
					}
				}

				// Build element→scene mapping
				const updatedTracks = editor.timeline.getTracks();
				const elementSceneMap: Record<string, number> = {};
				for (const track of updatedTracks) {
					for (const el of track.elements) {
						const elMid = el.startTime + el.duration / 2;
						const match = boundaries.boundaries.find(
							(b) => elMid >= b.startTime && elMid < b.endTime,
						);
						if (match) {
							elementSceneMap[el.id] = match.id;
						}
					}
				}

				await useSceneStore.getState().loadBoundaries(projectId);
				useSceneStore.getState().setElementSceneMap(elementSceneMap);
			} else {
				await useSceneStore.getState().loadBoundaries(projectId);
			}

			const scenes = boundaries.boundaries;
			const total = scenes.length;

			// Phase 4: Generate directions sequentially (each gets previous as context)
			setPipelinePhase("directions", "Generating scene directions...");
			setDirectionProgress({ current: 0, total });

			const directions: PlannedScene[] = [];
			for (let i = 0; i < scenes.length; i++) {
				const boundary = scenes[i];
				setDirectionProgress({ current: i + 1, total });

				const direction = await generateSceneDirection({
					boundary,
					transcript,
					previousDirection: directions[i - 1],
				});

				await setSceneDirection({
					projectId,
					sceneId: boundary.id,
					direction,
				});
				await useSceneStore.getState().refreshScene(projectId, boundary.id);
				directions.push(direction);
			}

			// Phase 5: Generate animation code in parallel
			setPipelinePhase("animations", "Generating animations...");
			setAnimationProgress({ current: 0, total });

			await Promise.all(
				scenes.map(async (boundary, i) => {
					const code = await generateSceneRemotionCode({
						scene: directions[i],
					});
					await setSceneRemotionCode({
						projectId,
						sceneId: boundary.id,
						code,
					});
					await useSceneStore.getState().refreshScene(projectId, boundary.id);
					incrementAnimationProgress();
				}),
			);

			// Enable animation overlay
			usePreviewStore
				.getState()
				.setOverlayVisibility({ overlay: "animations", isVisible: true });

			setPipelinePhase("done", "All animations generated");
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Pipeline failed";
			setError(msg);
			setPipelinePhase("error", msg);
		}
	};

	if (!hasApiKey) {
		return (
			<div className="flex h-full flex-col items-center justify-center px-6 py-12">
				<div className="w-full max-w-md text-center">
					<AlertCircle className="text-amber-500 size-12 mx-auto mb-4" />
					<h2 className="text-foreground text-xl font-bold">
						AI API key required
					</h2>
					<p className="text-muted-foreground mt-2 text-sm">
						You need to configure an AI provider to generate animations.
					</p>
					<div className="mt-6 flex gap-3 justify-center">
						<Button variant="outline" onClick={() => useWizardStore.getState().setStep(2)}>
							Back
						</Button>
						<Button
							onClick={() => {
								if (projectId) router.push(`/editor/${projectId}`);
							}}
						>
							Open in editor to configure
						</Button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col items-center px-6 py-10">
			<div className="w-full max-w-4xl">
				<div className="mb-8 text-center">
					<h1 className="text-foreground text-3xl font-bold tracking-tight">
						Generating your animation
					</h1>
					<p className="text-muted-foreground mt-2 text-base">
						Sit tight — the AI is crafting per-scene animations for your video.
					</p>
				</div>

				<div className="flex gap-8">
					{/* Pipeline progress */}
					<div className="flex-1">
						<div className="rounded-xl border border-border bg-card p-6">
							<div className="flex flex-col gap-4">
								{steps.map((step) => (
									<div key={step.key} className="flex items-start gap-3">
										{step.status === "done" ? (
											<CheckCircle2 className="text-primary size-5 shrink-0 mt-0.5" />
										) : step.status === "active" ? (
											<Loader2 className="text-primary size-5 shrink-0 animate-spin mt-0.5" />
										) : step.status === "error" ? (
											<AlertCircle className="text-destructive size-5 shrink-0 mt-0.5" />
										) : (
											<CircleDashed className="text-muted-foreground/40 size-5 shrink-0 mt-0.5" />
										)}
										<div>
											<p
												className={cn(
													"text-sm font-medium",
													step.status === "pending" &&
														"text-muted-foreground/50",
													step.status === "active" && "text-foreground",
													step.status === "done" &&
														"text-muted-foreground",
													step.status === "error" && "text-destructive",
												)}
											>
												{step.label}
											</p>
											{step.detail && (
												<p className="text-muted-foreground text-xs mt-0.5">
													{step.detail}
												</p>
											)}
										</div>
									</div>
								))}
							</div>

							{error && (
								<div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
									<p className="text-destructive text-sm">{error}</p>
									<button
										type="button"
										onClick={() => {
											setError(null);
											hasStarted.current = false;
											setPipelinePhase("idle");
											void runPipeline();
										}}
										className="text-destructive/80 hover:text-destructive mt-2 text-xs font-medium underline transition-colors"
									>
										Retry
									</button>
								</div>
							)}
						</div>
					</div>

					{/* Live preview */}
					<div className="w-48 shrink-0">
						<div className="sticky top-4">
							<p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
								Preview
							</p>
							<div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl border border-border bg-black">
								{/* AnimationOverlay renders animations as they complete */}
								<AnimationOverlay />
							</div>
						</div>
					</div>
				</div>

				{/* Footer actions */}
				{pipelinePhase === "done" && (
					<div className="mt-8 flex items-center justify-end gap-3">
						<Button
							variant="outline"
							onClick={() => {
								if (projectId) router.push(`/editor/${projectId}`);
							}}
						>
							Open in full editor
						</Button>
						<Button
							onClick={() => {
								if (projectId)
									router.push(`/editor/${projectId}?action=export`);
							}}
						>
							Export video
						</Button>
					</div>
				)}

				{pipelinePhase !== "done" && pipelinePhase !== "error" && (
					<div className="mt-8 flex justify-end">
						<button
							type="button"
							onClick={() => {
								if (projectId) router.push(`/editor/${projectId}`);
							}}
							className="text-muted-foreground hover:text-foreground text-sm transition-colors"
						>
							Skip and open in full editor
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
