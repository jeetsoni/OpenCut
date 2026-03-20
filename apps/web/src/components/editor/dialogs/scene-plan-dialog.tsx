import { useState, useEffect, useCallback } from "react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogBody,
	DialogFooter,
	DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { useEditor } from "@/hooks/use-editor";
import {
	getProjectBoundaries,
	setProjectBoundaries,
	deleteProjectBoundaries,
} from "@/lib/scene-planner/boundaries-store";
import { getProjectTranscript } from "@/lib/transcription/transcript-store";
import { getSceneDirection } from "@/lib/scene-planner/scene-direction-store";
import { getSceneRemotionCode } from "@/lib/remotion-renderer/scene-code-store";
import type { SceneBoundaries, SceneBoundary } from "@/lib/scene-planner/boundaries";
import type { PlannedScene } from "@/lib/scene-planner/schema";
import { invokeAction } from "@/lib/actions";
import { Sparkles, ChevronDown, ChevronRight, Play, Pencil, Check, X, Music } from "lucide-react";
import { applyAutoSfx, collectSfxHints } from "@/lib/scene-planner/auto-sfx";
import { EditorCore } from "@/core";
import { toast } from "sonner";

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

interface SceneStatus {
	hasDirection: boolean;
	hasAnimation: boolean;
}

export function ScenePlanDialog({
	isOpen,
	onOpenChange,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const editor = useEditor();
	const [boundaries, setBoundaries] = useState<SceneBoundaries | null>(null);
	const [hasTranscript, setHasTranscript] = useState(false);
	const [loading, setLoading] = useState(false);
	const [sceneStatuses, setSceneStatuses] = useState<Record<number, SceneStatus>>({});
	const [expandedScene, setExpandedScene] = useState<number | null>(null);
	const [sceneDirections, setSceneDirections] = useState<Record<number, PlannedScene>>({});

	const projectId = editor.project.getActive()?.metadata.id;

	const loadData = useCallback(async () => {
		if (!projectId) return;
		setLoading(true);

		const [boundariesResult, transcript] = await Promise.all([
			getProjectBoundaries({ projectId }),
			getProjectTranscript({ projectId }),
		]);

		setBoundaries(boundariesResult);
		setHasTranscript(Boolean(transcript));

		// Load per-scene statuses
		if (boundariesResult) {
			const statuses: Record<number, SceneStatus> = {};
			const directions: Record<number, PlannedScene> = {};

			await Promise.all(
				boundariesResult.boundaries.map(async (b) => {
					const [dir, code] = await Promise.all([
						getSceneDirection({ projectId, sceneId: b.id }),
						getSceneRemotionCode({ projectId, sceneId: b.id }),
					]);
					statuses[b.id] = {
						hasDirection: Boolean(dir),
						hasAnimation: Boolean(code),
					};
					if (dir) directions[b.id] = dir;
				}),
			);

			setSceneStatuses(statuses);
			setSceneDirections(directions);
		}

		setLoading(false);
	}, [projectId]);

	useEffect(() => {
		if (isOpen) loadData();
	}, [isOpen, loadData]);

	// Poll for updates while dialog is open (picks up async AI results)
	useEffect(() => {
		if (!isOpen) return;
		const interval = setInterval(loadData, 3000);
		return () => clearInterval(interval);
	}, [isOpen, loadData]);

	const handleDetectBoundaries = () => {
		onOpenChange(false);
		invokeAction("detect-scene-boundaries");
	};

	const handleRedetect = async () => {
		if (!projectId) return;
		await deleteProjectBoundaries({ projectId });
		onOpenChange(false);
		invokeAction("detect-scene-boundaries");
	};

	const handleGenerateDirection = (sceneId: number) => {
		invokeAction("generate-scene-direction", { sceneId });
	};

	const handleGenerateAnimation = (sceneId: number) => {
		invokeAction("generate-scene-animation", { sceneId });
	};

	const handleApplySfx = async (sceneId: number) => {
		const direction = sceneDirections[sceneId];
		if (!direction) return;

		const hints = collectSfxHints(direction);
		if (hints.length === 0) {
			toast.info("No SFX hints found in this scene's animation direction.");
			return;
		}

		const toastId = `sfx-${sceneId}`;
		toast.loading(`Adding ${hints.length} SFX clip${hints.length > 1 ? "s" : ""}…`, { id: toastId });

		const coreEditor = EditorCore.getInstance();
		const results = await applyAutoSfx({ direction, editor: coreEditor });

		const succeeded = results.filter((r) => r.success).length;
		const failed = results.filter((r) => !r.success).length;

		if (succeeded > 0 && failed === 0) {
			toast.success(`Added ${succeeded} SFX clip${succeeded > 1 ? "s" : ""} to timeline`, { id: toastId });
		} else if (succeeded > 0) {
			toast.success(`Added ${succeeded} SFX clip${succeeded > 1 ? "s" : ""} (${failed} failed)`, { id: toastId });
		} else {
			toast.error("Failed to add SFX clips", { id: toastId });
		}
	};

	const handleSeekToScene = (boundary: SceneBoundary) => {
		editor.playback.seek({ time: boundary.startTime });
	};

	const handleUpdateBoundary = async (
		sceneId: number,
		updates: Partial<Pick<SceneBoundary, "startTime" | "endTime" | "name">>,
	) => {
		if (!boundaries || !projectId) return;

		const updated: SceneBoundaries = {
			...boundaries,
			boundaries: boundaries.boundaries.map((b) =>
				b.id === sceneId ? { ...b, ...updates } : b,
			),
		};

		setBoundaries(updated);
		await setProjectBoundaries({ projectId, boundaries: updated });
	};

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent
				className="max-w-3xl"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle>Scene Plan</DialogTitle>
					<DialogDescription>
						{boundaries
							? `${boundaries.boundaries.length} scenes · ${boundaries.totalDuration.toFixed(1)}s`
							: "Detect scene boundaries from your transcript"}
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="p-0">
					{loading ? (
						<div className="flex items-center justify-center py-12">
							<p className="text-muted-foreground text-sm">Loading...</p>
						</div>
					) : boundaries ? (
						<ScrollArea className="h-[500px] px-4 py-3">
							<div className="space-y-2">
								{boundaries.boundaries.map((boundary) => (
									<SceneBoundaryCard
										key={boundary.id}
										boundary={boundary}
										status={sceneStatuses[boundary.id]}
										direction={sceneDirections[boundary.id]}
										isExpanded={expandedScene === boundary.id}
										onToggle={() =>
											setExpandedScene(
												expandedScene === boundary.id ? null : boundary.id,
											)
										}
										onSeek={() => handleSeekToScene(boundary)}
										onGenerateDirection={() => handleGenerateDirection(boundary.id)}
										onGenerateAnimation={() => handleGenerateAnimation(boundary.id)}
										onApplySfx={() => handleApplySfx(boundary.id)}
										onUpdateBoundary={(updates) =>
											handleUpdateBoundary(boundary.id, updates)
										}
									/>
								))}
							</div>
						</ScrollArea>
					) : (
						<div className="flex flex-col items-center justify-center gap-3 py-12">
							<p className="text-muted-foreground text-sm">
								{hasTranscript
									? "Detect scene boundaries from your transcript, then work on each scene individually."
									: "Generate a transcript first, then detect scene boundaries."}
							</p>
							<Button onClick={handleDetectBoundaries} disabled={!hasTranscript}>
								{hasTranscript ? "Detect Scene Boundaries" : "Transcript Required"}
							</Button>
						</div>
					)}
				</DialogBody>

				{boundaries && (
					<DialogFooter>
						<Button variant="outline" size="sm" onClick={handleRedetect}>
							Re-detect Boundaries
						</Button>
						<Button onClick={() => onOpenChange(false)}>Done</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}

function SceneBoundaryCard({
	boundary,
	status,
	direction,
	isExpanded,
	onToggle,
	onSeek,
	onGenerateDirection,
	onGenerateAnimation,
	onApplySfx,
	onUpdateBoundary,
}: {
	boundary: SceneBoundary;
	status?: SceneStatus;
	direction?: PlannedScene;
	isExpanded: boolean;
	onToggle: () => void;
	onSeek: () => void;
	onGenerateDirection: () => void;
	onGenerateAnimation: () => void;
	onApplySfx: () => Promise<void>;
	onUpdateBoundary: (updates: Partial<Pick<SceneBoundary, "startTime" | "endTime" | "name">>) => void;
}) {
	const accentColor = SCENE_TYPE_COLORS[boundary.type] || "#5BB8F5";
	const [isEditingTime, setIsEditingTime] = useState(false);
	const [editStart, setEditStart] = useState(boundary.startTime.toFixed(2));
	const [editEnd, setEditEnd] = useState(boundary.endTime.toFixed(2));
	const [isApplyingSfx, setIsApplyingSfx] = useState(false);

	const hasSfxHints =
		direction != null &&
		direction.animationDirection.beats.some((b) => b.sfx.length > 0);

	const handleApplySfxClick = async () => {
		setIsApplyingSfx(true);
		try {
			await onApplySfx();
		} finally {
			setIsApplyingSfx(false);
		}
	};

	const handleSaveTime = () => {
		const newStart = Number.parseFloat(editStart);
		const newEnd = Number.parseFloat(editEnd);
		if (!Number.isNaN(newStart) && !Number.isNaN(newEnd) && newEnd > newStart) {
			onUpdateBoundary({ startTime: newStart, endTime: newEnd });
		}
		setIsEditingTime(false);
	};

	return (
		<div
			className="border rounded-lg overflow-hidden transition-colors hover:border-foreground/20"
			style={{ borderLeftColor: accentColor, borderLeftWidth: 3 }}
		>
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2.5">
				<button type="button" onClick={onToggle} className="shrink-0">
					{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				</button>

				<span
					className="text-xs font-medium px-2 py-0.5 rounded shrink-0"
					style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
				>
					{boundary.type}
				</span>

				<button
					type="button"
					className="text-sm font-medium truncate text-left flex-1 hover:underline"
					onClick={onToggle}
				>
					{boundary.name}
				</button>

				{/* Time display / edit */}
				{isEditingTime ? (
					<div className="flex items-center gap-1 shrink-0">
						<Input
							value={editStart}
							onChange={(e) => setEditStart(e.target.value)}
							className="w-16 h-6 text-xs px-1"
						/>
						<span className="text-xs text-muted-foreground">–</span>
						<Input
							value={editEnd}
							onChange={(e) => setEditEnd(e.target.value)}
							className="w-16 h-6 text-xs px-1"
						/>
						<button type="button" onClick={handleSaveTime} className="text-green-500">
							<Check size={14} />
						</button>
						<button type="button" onClick={() => setIsEditingTime(false)} className="text-red-400">
							<X size={14} />
						</button>
					</div>
				) : (
					<button
						type="button"
						className="text-muted-foreground text-xs shrink-0 hover:text-foreground flex items-center gap-1"
						onClick={() => {
							setEditStart(boundary.startTime.toFixed(2));
							setEditEnd(boundary.endTime.toFixed(2));
							setIsEditingTime(true);
						}}
					>
						{boundary.startTime.toFixed(1)}s – {boundary.endTime.toFixed(1)}s
						<Pencil size={10} />
					</button>
				)}

				{/* Seek button */}
				<button
					type="button"
					onClick={onSeek}
					className="text-muted-foreground hover:text-foreground shrink-0"
					title="Seek to scene start"
				>
					<Play size={14} />
				</button>

				{/* Status indicators */}
				<div className="flex items-center gap-1 shrink-0">
					{status?.hasDirection && (
						<span className="w-2 h-2 rounded-full bg-blue-400" title="Direction ready" />
					)}
					{status?.hasAnimation && (
						<span className="w-2 h-2 rounded-full bg-green-400" title="Animation ready" />
					)}
				</div>
			</div>

			{/* Expanded content */}
			{isExpanded && (
				<div className="px-4 pb-4 space-y-3 border-t pt-3">
					<p className="text-muted-foreground text-xs leading-relaxed">
						"{boundary.text}"
					</p>

					{/* Action buttons */}
					<div className="flex flex-wrap items-center gap-2">
						{!status?.hasDirection ? (
							<Button size="sm" variant="outline" onClick={onGenerateDirection}>
								<Sparkles size={14} className="mr-1.5" />
								Generate Direction
							</Button>
						) : (
							<Button size="sm" variant="outline" onClick={onGenerateDirection}>
								<Sparkles size={14} className="mr-1.5" />
								Regenerate Direction
							</Button>
						)}

						{status?.hasDirection && (
							<>
								{!status?.hasAnimation ? (
									<Button size="sm" onClick={onGenerateAnimation}>
										<Sparkles size={14} className="mr-1.5" />
										Generate Animation
									</Button>
								) : (
									<Button size="sm" variant="outline" onClick={onGenerateAnimation}>
										Regenerate Animation
									</Button>
								)}

								{hasSfxHints && (
									<Button
										size="sm"
										variant="outline"
										onClick={handleApplySfxClick}
										disabled={isApplyingSfx}
									>
										<Music size={14} className="mr-1.5" />
										{isApplyingSfx ? "Adding SFX…" : "Add SFX"}
									</Button>
								)}
							</>
						)}
					</div>

					{/* Direction preview */}
					{direction && (
						<div className="space-y-2 mt-2">
							<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
								Animation Beats
							</p>
							{direction.animationDirection.beats.map((beat) => (
								<div
									key={beat.id}
									className="bg-muted/30 rounded p-3 space-y-1.5 text-xs"
								>
									<div className="flex justify-between">
										<span className="font-medium">{beat.id}</span>
										<span className="text-muted-foreground">
											{beat.timeRange[0].toFixed(1)}s – {beat.timeRange[1].toFixed(1)}s
										</span>
									</div>
									<p className="text-muted-foreground leading-relaxed">
										{beat.visual.slice(0, 200)}
										{beat.visual.length > 200 ? "..." : ""}
									</p>
									{beat.sfx.length > 0 && (
										<div className="flex flex-wrap gap-1 pt-0.5">
											{beat.sfx.map((sfx) => (
												<span
													key={sfx}
													className="text-muted-foreground/70 bg-muted/50 rounded px-1.5 py-0.5 font-mono text-[10px]"
												>
													{sfx}
												</span>
											))}
										</div>
									)}
								</div>
							))}
						</div>
					)}

					{/* Status summary */}
					<div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
						<span className={status?.hasDirection ? "text-blue-400" : ""}>
							{status?.hasDirection ? "✓ Direction" : "○ No direction"}
						</span>
						<span className={status?.hasAnimation ? "text-green-400" : ""}>
							{status?.hasAnimation ? "✓ Animation" : "○ No animation"}
						</span>
					</div>
				</div>
			)}
		</div>
	);
}
