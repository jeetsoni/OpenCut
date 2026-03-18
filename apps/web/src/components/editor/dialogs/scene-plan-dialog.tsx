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
import { useEditor } from "@/hooks/use-editor";
import {
	getProjectScenePlan,
	deleteProjectScenePlan,
} from "@/lib/scene-planner/scene-plan-store";
import { getProjectTranscript } from "@/lib/transcription/transcript-store";
import type { ScenePlan, PlannedScene } from "@/lib/scene-planner/schema";
import { invokeAction } from "@/lib/actions";

export function ScenePlanDialog({
	isOpen,
	onOpenChange,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const editor = useEditor();
	const [scenePlan, setScenePlan] = useState<ScenePlan | null>(null);
	const [hasTranscript, setHasTranscript] = useState(false);
	const [loading, setLoading] = useState(false);
	const [expandedScene, setExpandedScene] = useState<number | null>(null);

	const projectId = editor.project.getActive()?.metadata.id;

	const loadData = useCallback(async () => {
		if (!projectId) return;
		setLoading(true);
		const [plan, transcript] = await Promise.all([
			getProjectScenePlan({ projectId }),
			getProjectTranscript({ projectId }),
		]);
		setScenePlan(plan);
		setHasTranscript(Boolean(transcript));
		setLoading(false);
	}, [projectId]);

	useEffect(() => {
		if (isOpen) loadData();
	}, [isOpen, loadData]);

	const handleGenerate = () => {
		onOpenChange(false);
		invokeAction("generate-scene-plan");
	};

	const handleRegenerate = async () => {
		if (!projectId) return;
		await deleteProjectScenePlan({ projectId });
		onOpenChange(false);
		invokeAction("generate-scene-plan");
	};

	const handleExportJSON = () => {
		if (!scenePlan) return;
		const blob = new Blob([JSON.stringify(scenePlan, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "scene-plan.json";
		a.click();
		URL.revokeObjectURL(url);
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
						{scenePlan
							? `${scenePlan.scenes.length} scenes · ${scenePlan.totalDuration.toFixed(1)}s · Click a scene to expand`
							: "Generate an AI scene plan from your transcript"}
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="p-0">
					{loading ? (
						<div className="flex items-center justify-center py-12">
							<p className="text-muted-foreground text-sm">Loading...</p>
						</div>
					) : scenePlan ? (
						<ScenePlanView
							scenePlan={scenePlan}
							expandedScene={expandedScene}
							onToggleScene={(id) =>
								setExpandedScene(expandedScene === id ? null : id)
							}
						/>
					) : (
						<div className="flex flex-col items-center justify-center gap-3 py-12">
							<p className="text-muted-foreground text-sm">
								{hasTranscript
									? "No scene plan yet. Generate one from your transcript."
									: "Generate a transcript first, then create a scene plan."}
							</p>
							<Button onClick={handleGenerate} disabled={!hasTranscript}>
								{hasTranscript ? "Generate Scene Plan" : "Transcript Required"}
							</Button>
						</div>
					)}
				</DialogBody>

				{scenePlan && (
					<DialogFooter>
						<Button variant="outline" size="sm" onClick={handleRegenerate}>
							Regenerate
						</Button>
						<Button variant="outline" size="sm" onClick={handleExportJSON}>
							Export JSON
						</Button>
						<Button onClick={() => onOpenChange(false)}>Done</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}

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

function ScenePlanView({
	scenePlan,
	expandedScene,
	onToggleScene,
}: {
	scenePlan: ScenePlan;
	expandedScene: number | null;
	onToggleScene: (id: number) => void;
}) {
	return (
		<ScrollArea className="h-[500px] px-4 py-3">
			<div className="space-y-2">
				{scenePlan.scenes.map((scene) => (
					<SceneCard
						key={scene.id}
						scene={scene}
						isExpanded={expandedScene === scene.id}
						onToggle={() => onToggleScene(scene.id)}
					/>
				))}
			</div>
		</ScrollArea>
	);
}

function SceneCard({
	scene,
	isExpanded,
	onToggle,
}: {
	scene: PlannedScene;
	isExpanded: boolean;
	onToggle: () => void;
}) {
	const accentColor = SCENE_TYPE_COLORS[scene.type] || "#5BB8F5";

	return (
		<div
			className="border rounded-lg overflow-hidden cursor-pointer transition-colors hover:border-foreground/20"
			style={{ borderLeftColor: accentColor, borderLeftWidth: 3 }}
		>
			<button
				type="button"
				className="w-full text-left px-4 py-3 flex items-center justify-between gap-3"
				onClick={onToggle}
			>
				<div className="flex items-center gap-3 min-w-0">
					<span
						className="text-xs font-medium px-2 py-0.5 rounded"
						style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
					>
						{scene.type}
					</span>
					<span className="text-sm font-medium truncate">{scene.name}</span>
				</div>
				<span className="text-muted-foreground text-xs shrink-0">
					{scene.startTime.toFixed(1)}s – {scene.endTime.toFixed(1)}s
				</span>
			</button>

			{isExpanded && (
				<div className="px-4 pb-4 space-y-3 border-t pt-3">
					<p className="text-muted-foreground text-xs">{scene.description}</p>
					<p className="text-sm leading-relaxed">{scene.text}</p>

					<div className="space-y-2">
						<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
							Animation Beats
						</p>
						{scene.animationDirection.beats.map((beat) => (
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
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
