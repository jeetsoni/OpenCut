"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSceneStore } from "@/stores/scene-store";
import { invokeAction } from "@/lib/actions";
import { Sparkles, Play, Pencil, AlertTriangle, Wrench, Paperclip, X, ImageIcon } from "lucide-react";
import { useEditor } from "@/hooks/use-editor";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "../section";

const SCENE_TYPE_COLORS: Record<string, string> = {
	Hook: "#F55B5B",
	Analogy: "#F5A623",
	Bridge: "#7B6CF6",
	Architecture: "#5BB8F5",
	Spotlight: "#3DD68C",
	Comparison: "#F5A623",
	Power: "#E8FF47",
	CTA: "#E8FF47",
};

export function SceneSection({ elementId }: { elementId: string }) {
	const editor = useEditor();
	const boundaries = useSceneStore((s) => s.boundaries);
	const elementSceneMap = useSceneStore((s) => s.elementSceneMap);
	const sceneStatuses = useSceneStore((s) => s.sceneStatuses);
	const tweakOpenSceneId = useSceneStore((s) => s.tweakOpenSceneId);
	const setTweakOpenSceneId = useSceneStore((s) => s.setTweakOpenSceneId);
	const [tweakPrompt, setTweakPrompt] = useState("");
	const [showTweak, setShowTweak] = useState(false);
	const [attachedImages, setAttachedImages] = useState<string[]>([]);
	/** Auto-captured frame from the current playhead position */
	const [autoCapture, setAutoCapture] = useState<string | null>(null);
	const [isCapturing, setIsCapturing] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const sceneId = elementSceneMap[elementId];
	const boundary = boundaries?.boundaries.find((b) => b.id === sceneId);

	// Auto-open the tweak area when triggered from the timeline context menu
	useEffect(() => {
		if (tweakOpenSceneId != null && tweakOpenSceneId === sceneId) {
			setShowTweak(true);
			setTweakOpenSceneId(null);
		}
	}, [tweakOpenSceneId, sceneId, setTweakOpenSceneId]);

	// When the tweak panel opens, silently capture the current playhead frame
	// so the user can preview (and optionally remove) it before submitting.
	useEffect(() => {
		if (!showTweak) return;
		let cancelled = false;
		setAutoCapture(null);
		setIsCapturing(true);

		void (async () => {
			try {
				const projectId = editor.project.getActive()?.metadata.id;
				if (!projectId || cancelled) return;
				const [{ getSceneRemotionCode }, { getSceneDirection }, { captureFrameAtTime }] =
					await Promise.all([
						import("@/lib/remotion-renderer/scene-code-store"),
						import("@/lib/scene-planner/scene-direction-store"),
						import("@/lib/remotion-renderer/capture-frames"),
					]);
				const [codeResult, direction] = await Promise.all([
					getSceneRemotionCode({ projectId, sceneId }),
					getSceneDirection({ projectId, sceneId }),
				]);
				if (!codeResult || !direction || cancelled) return;
				const currentTime = editor.playback.getCurrentTime();
				const frame = await captureFrameAtTime(codeResult.code, direction, currentTime);
				if (!cancelled && frame) setAutoCapture(frame);
			} catch {
				// best-effort — never block the UI
			} finally {
				if (!cancelled) setIsCapturing(false);
			}
		})();

		return () => { cancelled = true; };
	}, [showTweak, sceneId]); // eslint-disable-line react-hooks/exhaustive-deps

	if (!boundary || sceneId == null) return null;

	const status = sceneStatuses[sceneId];
	const direction = status?.direction;
	const color = SCENE_TYPE_COLORS[boundary.type] || "#5BB8F5";

	return (
		<Section collapsible sectionKey={`scene-direction-${elementId}`}>
			<SectionHeader
				leading={
					<span
						className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
						style={{ backgroundColor: `${color}20`, color }}
					>
						{boundary.type}
					</span>
				}
			>
				<SectionTitle>{boundary.name}</SectionTitle>
			</SectionHeader>
			<SectionContent>
				<div className="space-y-3">
					<p className="text-muted-foreground text-xs">
						{boundary.startTime.toFixed(1)}s – {boundary.endTime.toFixed(1)}s
						({(boundary.endTime - boundary.startTime).toFixed(1)}s)
					</p>

					<div className="flex flex-col gap-1.5">
						<Button
							size="sm"
							variant={status?.hasDirection ? "outline" : "default"}
							className="w-full"
							onClick={() =>
								invokeAction("generate-scene-direction", { sceneId })
							}
						>
							<Sparkles size={14} className="mr-1.5" />
							{status?.hasDirection
								? "Regenerate Direction"
								: "Generate Direction"}
						</Button>

						{status?.hasDirection && (
							<Button
								size="sm"
								variant={status?.hasAnimation ? "outline" : "default"}
								className="w-full"
								onClick={() =>
									invokeAction("generate-scene-animation", { sceneId })
								}
							>
								<Sparkles size={14} className="mr-1.5" />
								{status?.hasAnimation
									? "Regenerate Animation"
									: "Generate Animation"}
							</Button>
						)}

						{status?.hasAnimation && (
							<>
								<Button
									size="sm"
									variant="outline"
									className="w-full"
									onClick={() => setShowTweak((v) => !v)}
								>
									<Pencil size={14} className="mr-1.5" />
									Tweak Animation
								</Button>
								{showTweak && (
									<div className="flex flex-col gap-1.5">
										<Textarea
											placeholder="e.g. change accent color to blue, move title higher, make text bigger..."
											value={tweakPrompt}
											onChange={(e) => setTweakPrompt(e.target.value)}
											className="text-xs min-h-[60px] resize-none"
											rows={2}
										/>

										{/* Images — auto-captured + manually attached */}
										{(isCapturing || autoCapture || attachedImages.length > 0) && (
											<div className="flex flex-wrap gap-1.5">
												{/* Auto-captured frame */}
												{isCapturing && (
													<div className="h-14 w-14 rounded border border-border bg-muted/40 flex items-center justify-center">
														<ImageIcon size={16} className="text-muted-foreground animate-pulse" />
													</div>
												)}
												{!isCapturing && autoCapture && (
													<div className="relative group">
														{/* biome-ignore lint/performance/noImgElement: thumbnail preview */}
														<img
															src={`data:image/png;base64,${autoCapture}`}
															alt="Auto-captured frame"
															className="h-14 w-14 object-cover rounded border border-border"
															title="Current playhead frame (auto-captured)"
														/>
														{/* "auto" badge */}
														<span className="absolute bottom-0 left-0 right-0 text-center text-[8px] font-medium bg-black/60 text-white rounded-b leading-none py-0.5 pointer-events-none">
															auto
														</span>
														<button
															type="button"
															className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
															onClick={() => setAutoCapture(null)}
															aria-label="Remove auto-captured frame"
														>
															<X size={10} />
														</button>
													</div>
												)}
												{/* Manually attached images */}
												{attachedImages.map((img, i) => (
													<div key={i} className="relative group">
														{/* biome-ignore lint/performance/noImgElement: thumbnail preview */}
														<img
															src={`data:image/png;base64,${img}`}
															alt={`Attached ${i + 1}`}
															className="h-14 w-14 object-cover rounded border border-border"
														/>
														<button
															type="button"
															className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
															onClick={() =>
																setAttachedImages((prev) =>
																	prev.filter((_, idx) => idx !== i),
																)
															}
															aria-label="Remove image"
														>
															<X size={10} />
														</button>
													</div>
												))}
											</div>
										)}

										<div className="flex gap-1.5">
											{/* Manual image attachment trigger */}
											<Button
												size="sm"
												variant="ghost"
												className="flex-none px-2"
												onClick={() => fileInputRef.current?.click()}
												title="Attach your own screenshot"
											>
												<Paperclip size={13} />
											</Button>
											<input
												ref={fileInputRef}
												type="file"
												accept="image/*"
												multiple
												className="hidden"
												onChange={(e) => {
													const files = Array.from(e.target.files ?? []);
													for (const file of files) {
														const reader = new FileReader();
														reader.onload = (ev) => {
															const dataUrl = ev.target?.result as string;
															const base64 = dataUrl.split(",")[1];
															if (base64) {
																setAttachedImages((prev) => [...prev, base64]);
															}
														};
														reader.readAsDataURL(file);
													}
													e.target.value = "";
												}}
											/>
											<Button
												size="sm"
												className="flex-1"
												disabled={!tweakPrompt.trim()}
												onClick={() => {
													const allImages = [
														...(autoCapture ? [autoCapture] : []),
														...attachedImages,
													];
													invokeAction("tweak-scene-animation", {
														sceneId,
														tweakPrompt,
														images: allImages.length > 0 ? allImages : undefined,
													});
													setTweakPrompt("");
													setAttachedImages([]);
													setAutoCapture(null);
													setShowTweak(false);
												}}
											>
												<Sparkles size={14} className="mr-1.5" />
												Apply Tweak
											</Button>
										</div>
										<p className="text-[10px] text-muted-foreground">
											<ImageIcon size={9} className="inline mr-1 mb-0.5" />
											Current frame auto-captured for context. Attach extra images if needed.
										</p>
									</div>
								)}
							</>
						)}

						{status?.animationError && (
							<div className="rounded border border-red-500/30 bg-red-500/10 p-2 space-y-1.5">
								<div className="flex items-start gap-1.5">
									<AlertTriangle size={12} className="text-red-400 mt-0.5 shrink-0" />
									<p className="text-[11px] text-red-400 leading-relaxed break-all">
										{status.animationError.length > 200
											? `${status.animationError.slice(0, 200)}...`
											: status.animationError}
									</p>
								</div>
								<Button
									size="sm"
									variant="destructive"
									className="w-full"
									onClick={() => {
										invokeAction("tweak-scene-animation", {
											sceneId,
											tweakPrompt: `Fix this runtime error in the animation code: "${status.animationError}". The component crashes when rendering. Fix the issue — likely an undefined variable, missing component, or incorrect reference. Only available globals are: React, useState, useEffect, useMemo, useCallback, AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring, Easing. Do NOT use any other imports or components.`,
										});
									}}
								>
									<Wrench size={14} className="mr-1.5" />
									Auto-Fix Animation
								</Button>
							</div>
						)}

						<Button
							size="sm"
							variant="ghost"
							className="w-full"
							onClick={() =>
								editor.playback.seek({ time: boundary.startTime })
							}
						>
							<Play size={14} className="mr-1.5" />
							Seek to scene
						</Button>
					</div>

					{direction && (
						<div className="space-y-1.5 pt-1">
							<p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
								Animation Beats
							</p>
							{direction.animationDirection.beats.map((beat) => (
								<div
									key={beat.id}
									className="bg-muted/30 rounded p-2.5 space-y-1 text-xs"
								>
									<div className="flex justify-between">
										<span className="font-medium">{beat.id}</span>
										<span className="text-muted-foreground">
											{beat.timeRange[0].toFixed(1)}s –{" "}
											{beat.timeRange[1].toFixed(1)}s
										</span>
									</div>
									<p className="text-muted-foreground leading-relaxed">
										{beat.visual.length > 150
											? `${beat.visual.slice(0, 150)}...`
											: beat.visual}
									</p>
								</div>
							))}
						</div>
					)}

					<div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t">
						<span className={status?.hasDirection ? "text-blue-400" : ""}>
							{status?.hasDirection ? "✓ Direction" : "○ No direction"}
						</span>
						<span className={status?.hasAnimation ? "text-green-400" : ""}>
							{status?.hasAnimation ? "✓ Animation" : "○ No animation"}
						</span>
					</div>
				</div>
			</SectionContent>
		</Section>
	);
}
