"use client";

import { useTimelineStore } from "@/stores/timeline-store";
import { useActionHandler } from "@/hooks/actions/use-action-handler";
import { useEditor } from "../use-editor";
import { useElementSelection } from "../timeline/element/use-element-selection";
import { useKeyframeSelection } from "../timeline/element/use-keyframe-selection";
import { getElementsAtTime } from "@/lib/timeline";
import { getAIProviderConfig } from "@/lib/ai-provider";
import { generateTranscript } from "@/lib/transcription/generate-transcript";
import {
	getProjectTranscript,
	setProjectTranscript,
} from "@/lib/transcription/transcript-store";
import { createTimelineAudioBuffer } from "@/lib/media/audio";
import { generateScenePlan } from "@/lib/scene-planner/generate-scenes";
import {
	getProjectScenePlan,
	setProjectScenePlan,
} from "@/lib/scene-planner/scene-plan-store";
import { generateRemotionCode } from "@/lib/remotion-renderer/generate-code";
import {
	getProjectRemotionCode,
	setProjectRemotionCode,
} from "@/lib/remotion-renderer/store";
import { detectSceneBoundaries } from "@/lib/scene-planner/detect-boundaries";
import {
	getProjectBoundaries,
	setProjectBoundaries,
} from "@/lib/scene-planner/boundaries-store";
import { generateSceneDirection } from "@/lib/scene-planner/generate-scene-direction";
import {
	getSceneDirection,
	setSceneDirection,
} from "@/lib/scene-planner/scene-direction-store";
import { generateSceneRemotionCode, tweakSceneRemotionCode } from "@/lib/remotion-renderer/generate-scene-code";
import {
	setSceneRemotionCode,
	getSceneRemotionCode,
} from "@/lib/remotion-renderer/scene-code-store";
import { toast } from "sonner";
import { useSceneStore } from "@/stores/scene-store";

export function useEditorActions() {
	const editor = useEditor();
	const activeProject = editor.project.getActive();
	const { selectedElements, setElementSelection } = useElementSelection();
	const { selectedKeyframes, clearKeyframeSelection } = useKeyframeSelection();
	const clipboard = useTimelineStore((s) => s.clipboard);
	const setClipboard = useTimelineStore((s) => s.setClipboard);
	const toggleSnapping = useTimelineStore((s) => s.toggleSnapping);
	const rippleEditingEnabled = useTimelineStore((s) => s.rippleEditingEnabled);
	const toggleRippleEditing = useTimelineStore((s) => s.toggleRippleEditing);

	useActionHandler(
		"toggle-play",
		() => {
			editor.playback.toggle();
		},
		undefined,
	);

	useActionHandler(
		"stop-playback",
		() => {
			if (editor.playback.getIsPlaying()) {
				editor.playback.toggle();
			}
			editor.playback.seek({ time: 0 });
		},
		undefined,
	);

	useActionHandler(
		"seek-forward",
		(args) => {
			const seconds = args?.seconds ?? 1;
			editor.playback.seek({
				time: Math.min(
					editor.timeline.getTotalDuration(),
					editor.playback.getCurrentTime() + seconds,
				),
			});
		},
		undefined,
	);

	useActionHandler(
		"seek-backward",
		(args) => {
			const seconds = args?.seconds ?? 1;
			editor.playback.seek({
				time: Math.max(0, editor.playback.getCurrentTime() - seconds),
			});
		},
		undefined,
	);

	useActionHandler(
		"frame-step-forward",
		() => {
			const fps = activeProject.settings.fps;
			editor.playback.seek({
				time: Math.min(
					editor.timeline.getTotalDuration(),
					editor.playback.getCurrentTime() + 1 / fps,
				),
			});
		},
		undefined,
	);

	useActionHandler(
		"frame-step-backward",
		() => {
			const fps = activeProject.settings.fps;
			editor.playback.seek({
				time: Math.max(0, editor.playback.getCurrentTime() - 1 / fps),
			});
		},
		undefined,
	);

	useActionHandler(
		"jump-forward",
		(args) => {
			const seconds = args?.seconds ?? 5;
			editor.playback.seek({
				time: Math.min(
					editor.timeline.getTotalDuration(),
					editor.playback.getCurrentTime() + seconds,
				),
			});
		},
		undefined,
	);

	useActionHandler(
		"jump-backward",
		(args) => {
			const seconds = args?.seconds ?? 5;
			editor.playback.seek({
				time: Math.max(0, editor.playback.getCurrentTime() - seconds),
			});
		},
		undefined,
	);

	useActionHandler(
		"goto-start",
		() => {
			editor.playback.seek({ time: 0 });
		},
		undefined,
	);

	useActionHandler(
		"goto-end",
		() => {
			editor.playback.seek({ time: editor.timeline.getTotalDuration() });
		},
		undefined,
	);

	useActionHandler(
		"split",
		() => {
			const currentTime = editor.playback.getCurrentTime();
			const elementsToSplit =
				selectedElements.length > 0
					? selectedElements
					: getElementsAtTime({
							tracks: editor.timeline.getTracks(),
							time: currentTime,
						});

			if (elementsToSplit.length === 0) return;

			editor.timeline.splitElements({
				elements: elementsToSplit,
				splitTime: currentTime,
			});
		},
		undefined,
	);

	useActionHandler(
		"split-left",
		() => {
			const currentTime = editor.playback.getCurrentTime();
			const elementsToSplit =
				selectedElements.length > 0
					? selectedElements
					: getElementsAtTime({
							tracks: editor.timeline.getTracks(),
							time: currentTime,
						});

			if (elementsToSplit.length === 0) return;

			const rightSideElements = editor.timeline.splitElements({
				elements: elementsToSplit,
				splitTime: currentTime,
				retainSide: "right",
				rippleEnabled: rippleEditingEnabled,
			});

			if (rippleEditingEnabled && rightSideElements.length > 0) {
				const firstRightElement = editor.timeline.getElementsWithTracks({
					elements: [rightSideElements[0]],
				})[0];
				if (firstRightElement) {
					editor.playback.seek({ time: firstRightElement.element.startTime });
				}
			}
		},
		undefined,
	);

	useActionHandler(
		"split-right",
		() => {
			const currentTime = editor.playback.getCurrentTime();
			const elementsToSplit =
				selectedElements.length > 0
					? selectedElements
					: getElementsAtTime({
							tracks: editor.timeline.getTracks(),
							time: currentTime,
						});

			if (elementsToSplit.length === 0) return;

			editor.timeline.splitElements({
				elements: elementsToSplit,
				splitTime: currentTime,
				retainSide: "left",
			});
		},
		undefined,
	);

	useActionHandler(
		"delete-selected",
		() => {
			if (selectedKeyframes.length > 0) {
				editor.timeline.removeKeyframes({ keyframes: selectedKeyframes });
				clearKeyframeSelection();
				return;
			}
			if (selectedElements.length === 0) {
				return;
			}
			editor.timeline.deleteElements({
				elements: selectedElements,
				rippleEnabled: rippleEditingEnabled,
			});
			editor.selection.clearSelection();
		},
		undefined,
	);

	useActionHandler(
		"select-all",
		() => {
			const allElements = editor.timeline.getTracks().flatMap((track) =>
				track.elements.map((element) => ({
					trackId: track.id,
					elementId: element.id,
				})),
			);
			setElementSelection({ elements: allElements });
		},
		undefined,
	);

	useActionHandler(
		"deselect-all",
		() => {
			setElementSelection({ elements: [] });
			clearKeyframeSelection();
			const activeElement = document.activeElement;
			if (activeElement instanceof HTMLButtonElement) {
				activeElement.blur();
			}
		},
		undefined,
	);

	useActionHandler(
		"duplicate-selected",
		() => {
			editor.timeline.duplicateElements({
				elements: selectedElements,
			});
		},
		undefined,
	);

	useActionHandler(
		"toggle-elements-muted-selected",
		() => {
			editor.timeline.toggleElementsMuted({ elements: selectedElements });
		},
		undefined,
	);

	useActionHandler(
		"toggle-elements-visibility-selected",
		() => {
			editor.timeline.toggleElementsVisibility({ elements: selectedElements });
		},
		undefined,
	);

	useActionHandler(
		"toggle-bookmark",
		() => {
			editor.scenes.toggleBookmark({ time: editor.playback.getCurrentTime() });
		},
		undefined,
	);

	useActionHandler(
		"copy-selected",
		() => {
			if (selectedElements.length === 0) return;

			const results = editor.timeline.getElementsWithTracks({
				elements: selectedElements,
			});
			const items = results.map(({ track, element }) => {
				const { id: _, ...elementWithoutId } = element;
				return {
					trackId: track.id,
					trackType: track.type,
					element: elementWithoutId,
				};
			});

			setClipboard({ items });
		},
		undefined,
	);

	useActionHandler(
		"paste-copied",
		() => {
			if (!clipboard?.items.length) return;

			editor.timeline.pasteAtTime({
				time: editor.playback.getCurrentTime(),
				clipboardItems: clipboard.items,
			});
		},
		undefined,
	);

	useActionHandler(
		"toggle-snapping",
		() => {
			toggleSnapping();
		},
		undefined,
	);

	useActionHandler(
		"toggle-ripple-editing",
		() => {
			toggleRippleEditing();
		},
		undefined,
	);

	useActionHandler(
		"undo",
		() => {
			editor.command.undo();
		},
		undefined,
	);

	useActionHandler(
		"redo",
		() => {
			editor.command.redo();
		},
		undefined,
	);

	useActionHandler(
		"remove-silence",
		() => {
			const targets =
				selectedElements.length > 0
					? selectedElements
					: editor.timeline
							.getTracks()
							.flatMap((track) =>
								track.elements.map((el) => ({
									trackId: track.id,
									elementId: el.id,
								})),
							);

			if (targets.length === 0) return;

			void editor.timeline.removeSilence({ elements: targets });
		},
		undefined,
	);

	useActionHandler(
		"remove-retakes",
		() => {
			const config = getAIProviderConfig();
			if (!config?.apiKey) {
				toast.error("AI provider not configured", {
					description: "Go to the menu → AI Settings to add your API key.",
				});
				return;
			}

			const targets =
				selectedElements.length > 0
					? selectedElements
					: editor.timeline
							.getTracks()
							.flatMap((track) =>
								track.elements.map((el) => ({
									trackId: track.id,
									elementId: el.id,
								})),
							);

			if (targets.length === 0) return;

			const toastId = toast.loading("Removing retakes...", {
				description: "Transcribing audio segments...",
			});

			void editor.timeline
				.removeRetakes({
					elements: targets,
					onProgress: (progress) => {
						const desc =
							progress.phase === "analyzing"
								? "This may take 10–30 seconds..."
								: undefined;
						toast.loading(progress.message, {
							id: toastId,
							description: desc,
						});
					},
				})
				.then(() => {
					toast.success("Retakes removed", { id: toastId });
				})
				.catch((error: unknown) => {
					const message =
						error instanceof Error ? error.message : "Unknown error";
					toast.error("Failed to remove retakes", {
						id: toastId,
						description: message,
					});
				});
		},
		undefined,
	);

	useActionHandler(
		"close-gaps",
		() => {
			editor.timeline.closeGaps();
		},
		undefined,
	);

	useActionHandler(
		"generate-transcript",
		() => {
			console.log("[transcript] Action handler fired");
			const config = getAIProviderConfig();
			const hasGroq = Boolean(config?.groqApiKey);
			if (!hasGroq) {
				// In-browser Whisper works too, but warn about quality
				toast.info("Using in-browser Whisper", {
					description:
						"For best word-level accuracy, add a Groq API key in AI Settings.",
				});
			}

			const projectId = editor.project.getActive()?.metadata.id;
			if (!projectId) {
				toast.error("No active project");
				return;
			}

			const toastId = toast.loading("Generating transcript...", {
				description: "Extracting audio from timeline...",
			});

			void (async () => {
				try {
					// Check if transcript already exists
					const existing = await getProjectTranscript({ projectId });
					if (existing) {
						toast.info("Transcript already exists", {
							id: toastId,
							description: `${existing.words.length} words, ${existing.duration.toFixed(1)}s. Re-generating...`,
						});
					}

					toast.loading("Mixing timeline audio...", { id: toastId });

					// Mix the edited timeline audio (respects all cuts, trims, splits)
					const tracks = editor.timeline.getTracks();
					const mediaAssets = editor.media.getAssets();
					const duration = editor.timeline.getTotalDuration();

					console.log("[transcript] tracks:", tracks.length, "assets:", mediaAssets.length, "duration:", duration);

					if (duration === 0) {
						toast.error("Timeline is empty", { id: toastId });
						return;
					}

					console.log("[transcript] Creating audio buffer...");
					const audioBuffer = await createTimelineAudioBuffer({
						tracks,
						mediaAssets,
						duration,
					});
					console.log("[transcript] Audio buffer result:", audioBuffer ? `${audioBuffer.length} samples, ${audioBuffer.numberOfChannels}ch` : "null");

					if (!audioBuffer) {
						toast.error("No audio found", {
							id: toastId,
							description: "Add a video or audio element to the timeline first.",
						});
						return;
					}

					// Mix down to mono Float32
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

					const transcript = await generateTranscript({
						samples,
						sampleRate: audioBuffer.sampleRate,
						onProgress: (progress) => {
							toast.loading(progress.message, {
								id: toastId,
								description:
									progress.phase === "transcribing"
										? `Chunk ${progress.current}/${progress.total}`
										: undefined,
							});
						},
					});

					await setProjectTranscript({ projectId, transcript });

					toast.success("Transcript generated", {
						id: toastId,
						description: `${transcript.words.length} words, ${transcript.duration.toFixed(1)}s`,
					});
				} catch (error: unknown) {
					const message =
						error instanceof Error ? error.message : "Unknown error";
					toast.error("Transcript generation failed", {
						id: toastId,
						description: message,
					});
				}
			})();
		},
		undefined,
	);

	useActionHandler(
		"generate-scene-plan",
		() => {
			const config = getAIProviderConfig();
			if (!config?.apiKey) {
				toast.error("AI provider not configured", {
					description: "Go to the menu → AI Settings to add your API key.",
				});
				return;
			}

			const projectId = editor.project.getActive()?.metadata.id;
			if (!projectId) {
				toast.error("No active project");
				return;
			}

			const toastId = toast.loading("Generating scene plan...", {
				description: "Loading transcript...",
			});

			void (async () => {
				try {
					const transcript = await getProjectTranscript({ projectId });
					if (!transcript) {
						toast.error("No transcript found", {
							id: toastId,
							description: "Generate a transcript first before planning scenes.",
						});
						return;
					}

					const existing = await getProjectScenePlan({ projectId });
					if (existing) {
						toast.info("Scene plan exists — regenerating...", {
							id: toastId,
							description: `${existing.scenes.length} scenes previously generated.`,
						});
					}

					const scenePlan = await generateScenePlan({
						transcript,
						onProgress: (progress) => {
							toast.loading(progress.message, { id: toastId });
						},
					});

					await setProjectScenePlan({ projectId, scenePlan });

					toast.success("Scene plan generated", {
						id: toastId,
						description: `${scenePlan.scenes.length} scenes with animation directions`,
					});
				} catch (error: unknown) {
					const message =
						error instanceof Error ? error.message : "Unknown error";
					toast.error("Scene plan generation failed", {
						id: toastId,
						description: message,
					});
				}
			})();
		},
		undefined,
	);

	useActionHandler(
		"generate-animations",
		() => {
			const config = getAIProviderConfig();
			if (!config?.apiKey) {
				toast.error("AI provider not configured", {
					description: "Go to the menu → AI Settings to add your API key.",
				});
				return;
			}

			const projectId = editor.project.getActive()?.metadata.id;
			if (!projectId) {
				toast.error("No active project");
				return;
			}

			const toastId = toast.loading("Generating animations...", {
				description: "Loading scene plan...",
			});

			void (async () => {
				try {
					const scenePlan = await getProjectScenePlan({ projectId });
					if (!scenePlan) {
						toast.error("No scene plan found", {
							id: toastId,
							description:
								"Generate a scene plan first before creating animations.",
						});
						return;
					}

					const code = await generateRemotionCode({
						scenePlan,
						onProgress: (progress) => {
							toast.loading(progress.message, { id: toastId });
						},
					});

					await setProjectRemotionCode({ projectId, code });

					toast.success("Animations generated", {
						id: toastId,
						description:
							"Open the Scene Plan dialog → Animation Preview to see them.",
					});
				} catch (error: unknown) {
					const message =
						error instanceof Error ? error.message : "Unknown error";
					toast.error("Animation generation failed", {
						id: toastId,
						description: message,
					});
				}
			})();
		},
		undefined,
	);

	// --- Detect scene boundaries (lightweight, step 1) ---
	useActionHandler(
		"detect-scene-boundaries",
		() => {
			const config = getAIProviderConfig();
			if (!config?.apiKey) {
				toast.error("AI provider not configured", {
					description: "Go to the menu → AI Settings to add your API key.",
				});
				return;
			}

			const projectId = editor.project.getActive()?.metadata.id;
			if (!projectId) {
				toast.error("No active project");
				return;
			}

			const toastId = toast.loading("Detecting scene boundaries...", {
				description: "Loading transcript...",
			});

			void (async () => {
				try {
					const transcript = await getProjectTranscript({ projectId });
					if (!transcript) {
						toast.error("No transcript found", {
							id: toastId,
							description: "Generate a transcript first.",
						});
						return;
					}

					const boundaries = await detectSceneBoundaries({
						transcript,
						onProgress: (p) => toast.loading(p.message, { id: toastId }),
					});

					await setProjectBoundaries({ projectId, boundaries });

					// Close gaps first so clips are contiguous on the timeline
					toast.loading("Applying scene splits...", { id: toastId });
					editor.timeline.closeGaps();

					// Merge adjacent clips that share the same media source and have
					// contiguous source ranges. This collapses previously-split clips
					// back into larger ones before we re-split at scene boundaries.
					editor.timeline.mergeAdjacentElements();

					// Now split at each scene boundary time
					const splitTimes = boundaries.boundaries
						.map((b) => b.startTime)
						.filter((t) => t > 0)
						.sort((a, b) => a - b);

					for (const splitTime of splitTimes) {
						const currentTracks = editor.timeline.getTracks();
						const elementsAtTime: { trackId: string; elementId: string }[] = [];
						for (const track of currentTracks) {
							for (const el of track.elements) {
								if (el.startTime < splitTime && el.startTime + el.duration > splitTime) {
									elementsAtTime.push({ trackId: track.id, elementId: el.id });
								}
							}
						}
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
							const matchingBoundary = boundaries.boundaries.find(
								(b) => elMid >= b.startTime && elMid < b.endTime,
							);
							if (matchingBoundary) {
								elementSceneMap[el.id] = matchingBoundary.id;
							}
						}
					}

					// Update the scene store
					await useSceneStore.getState().loadBoundaries(projectId);
					useSceneStore.getState().setElementSceneMap(elementSceneMap);

					toast.success("Scene boundaries applied", {
						id: toastId,
						description: `${boundaries.boundaries.length} scenes. Click any clip to inspect.`,
					});
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : "Unknown error";
					toast.error("Boundary detection failed", {
						id: toastId,
						description: message,
					});
				}
			})();
		},
		undefined,
	);

	// --- Generate direction for a specific scene ---
	useActionHandler(
		"generate-scene-direction",
		(args) => {
			const sceneId = (args as { sceneId?: number })?.sceneId;
			if (sceneId == null) {
				toast.error("No scene selected");
				return;
			}

			const config = getAIProviderConfig();
			if (!config?.apiKey) {
				toast.error("AI provider not configured");
				return;
			}

			const projectId = editor.project.getActive()?.metadata.id;
			if (!projectId) {
				toast.error("No active project");
				return;
			}

			const toastId = toast.loading("Generating scene direction...");

			void (async () => {
				try {
					const [boundaries, transcript] = await Promise.all([
						getProjectBoundaries({ projectId }),
						getProjectTranscript({ projectId }),
					]);

					if (!boundaries) {
						toast.error("No boundaries found", { id: toastId });
						return;
					}
					if (!transcript) {
						toast.error("No transcript found", { id: toastId });
						return;
					}

					const boundary = boundaries.boundaries.find((b) => b.id === sceneId);
					if (!boundary) {
						toast.error("Scene not found", { id: toastId });
						return;
					}

					const direction = await generateSceneDirection({
						boundary,
						transcript,
						onProgress: (p) => toast.loading(p.message, { id: toastId }),
					});

					await setSceneDirection({ projectId, sceneId, direction });

					// Refresh this scene in the store
					await useSceneStore.getState().refreshScene(projectId, sceneId);

					toast.success(`Direction ready for "${boundary.name}"`, { id: toastId });
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : "Unknown error";
					toast.error("Direction generation failed", {
						id: toastId,
						description: message,
					});
				}
			})();
		},
		undefined,
	);

	// --- Generate animation code for a specific scene ---
	useActionHandler(
		"generate-scene-animation",
		(args) => {
			const sceneId = (args as { sceneId?: number })?.sceneId;
			if (sceneId == null) {
				toast.error("No scene selected");
				return;
			}

			const config = getAIProviderConfig();
			if (!config?.apiKey) {
				toast.error("AI provider not configured");
				return;
			}

			const projectId = editor.project.getActive()?.metadata.id;
			if (!projectId) {
				toast.error("No active project");
				return;
			}

			const toastId = toast.loading("Generating scene animation...");

			void (async () => {
				try {
					const direction = await getSceneDirection({ projectId, sceneId });
					if (!direction) {
						toast.error("No direction found for this scene", {
							id: toastId,
							description: "Generate design direction first.",
						});
						return;
					}

					const code = await generateSceneRemotionCode({
						scene: direction,
						onProgress: (p) => toast.loading(p.message, { id: toastId }),
					});

					await setSceneRemotionCode({ projectId, sceneId, code });

					// Refresh this scene in the store + enable animation overlay
					await useSceneStore.getState().refreshScene(projectId, sceneId);
					const { usePreviewStore } = await import("@/stores/preview-store");
					usePreviewStore.getState().setOverlayVisibility({ overlay: "animations", isVisible: true });

					toast.success(`Animation ready for "${direction.name}"`, {
						id: toastId,
					});
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : "Unknown error";
					toast.error("Animation generation failed", {
						id: toastId,
						description: message,
					});
				}
			})();
		},
		undefined,
	);

	// --- Bake animations to MP4 via server-side Remotion render ---
	useActionHandler(
		"bake-animation",
		() => {
			const projectId = editor.project.getActive()?.metadata.id;
			if (!projectId) {
				toast.error("No active project");
				return;
			}

			const toastId = toast.loading("Baking animations...", {
				description: "Gathering scene data...",
			});

			void (async () => {
				try {
					const { bakeAnimation } = await import(
						"@/services/renderer/bake-animation"
					);

					const result = await bakeAnimation({
						projectId,
						fps: activeProject.settings.fps,
						width: activeProject.settings.canvasSize.width,
						height: activeProject.settings.canvasSize.height,
						onProgress: (status) => {
							toast.loading("Baking animations...", {
								id: toastId,
								description: status,
							});
						},
					});

					if (!result.success) {
						toast.error("Animation bake failed", {
							id: toastId,
							description: result.error,
						});
						return;
					}

					// Create a File from the blob so it can be added as a media asset
					const file = new File([result.blob], "animation-overlay.mp4", {
						type: "video/mp4",
					});

					await editor.media.addMediaAsset({
						file,
						name: "Animation Overlay",
					});

					toast.success("Animation baked successfully", {
						id: toastId,
						description:
							"The animation MP4 has been added to your media assets. Drag it onto the timeline as an overlay track for export.",
					});
				} catch (error: unknown) {
					const message =
						error instanceof Error ? error.message : "Unknown error";
					toast.error("Animation bake failed", {
						id: toastId,
						description: message,
					});
				}
			})();
		},
		undefined,
	);

	// --- Tweak existing animation code for a specific scene ---
	useActionHandler(
		"tweak-scene-animation",
		(args) => {
			const { sceneId, tweakPrompt } = (args as { sceneId?: number; tweakPrompt?: string }) ?? {};
			if (sceneId == null || !tweakPrompt?.trim()) {
				toast.error("Scene and tweak instructions required");
				return;
			}

			const config = getAIProviderConfig();
			if (!config?.apiKey) {
				toast.error("AI provider not configured");
				return;
			}

			const projectId = editor.project.getActive()?.metadata.id;
			if (!projectId) {
				toast.error("No active project");
				return;
			}

			const toastId = toast.loading("Tweaking animation...");

			void (async () => {
				try {
					const [direction, codeResult] = await Promise.all([
						getSceneDirection({ projectId, sceneId }),
						getSceneRemotionCode({ projectId, sceneId }),
					]);

					if (!direction) {
						toast.error("No direction found", { id: toastId });
						return;
					}
					if (!codeResult) {
						toast.error("No existing animation to tweak", {
							id: toastId,
							description: "Generate an animation first.",
						});
						return;
					}

					const code = await tweakSceneRemotionCode({
						existingCode: codeResult.code,
						tweakPrompt: tweakPrompt.trim(),
						scene: direction,
						onProgress: (p) => toast.loading(p.message, { id: toastId }),
					});

					await setSceneRemotionCode({ projectId, sceneId, code });

					await useSceneStore.getState().refreshScene(projectId, sceneId);
					const { usePreviewStore } = await import("@/stores/preview-store");
					usePreviewStore.getState().setOverlayVisibility({ overlay: "animations", isVisible: true });

					toast.success(`Animation tweaked for "${direction.name}"`, {
						id: toastId,
					});
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : "Unknown error";
					toast.error("Tweak failed", {
						id: toastId,
						description: message,
					});
				}
			})();
		},
		undefined,
	);
}
