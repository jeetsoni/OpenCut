"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSceneStore } from "@/stores/scene-store";
import { invokeAction } from "@/lib/actions";
import { useEditor } from "@/hooks/use-editor";
import { Sparkles, Play, Pencil, Check, X as XIcon } from "lucide-react";
import type { SceneBoundary } from "@/lib/scene-planner/boundaries";

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

export function SceneInspector() {
	const editor = useEditor();
	const projectId = editor.project.getActive()?.metadata.id;
	const selectedSceneId = useSceneStore((s) => s.selectedSceneId);
	const boundaries = useSceneStore((s) => s.boundaries);
	const sceneStatuses = useSceneStore((s) => s.sceneStatuses);
	const selectScene = useSceneStore((s) => s.selectScene);
	const setBoundaries = useSceneStore((s) => s.setBoundaries);

	const boundary = boundaries?.boundaries.find((b) => b.id === selectedSceneId);
	if (!boundary || !selectedSceneId || !projectId) return null;

	const status = sceneStatuses[selectedSceneId];
	const direction = status?.direction;
	const color = SCENE_TYPE_COLORS[boundary.type] || "#5BB8F5";

	const handleSeek = () => editor.playback.seek({ time: boundary.startTime });

	const handleUpdateTime = (updates: Partial<Pick<SceneBoundary, "startTime" | "endTime">>) => {
		if (!boundaries) return;
		const updated = {
			...boundaries,
			boundaries: boundaries.boundaries.map((b) =>
				b.id === selectedSceneId ? { ...b, ...updates } : b,
			),
		};
		setBoundaries(projectId, updated);
	};

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center justify-between border-b px-4 py-3">
				<div className="flex items-center gap-2 min-w-0">
					<span
						className="text-xs font-medium px-2 py-0.5 rounded shrink-0"
						style={{ backgroundColor: `${color}20`, color }}
					>
						{boundary.type}
					</span>
					<span className="text-sm font-medium truncate">{boundary.name}</span>
				</div>
				<button
					type="button"
					onClick={() => selectScene(null)}
					className="text-muted-foreground hover:text-foreground shrink-0"
				>
					<XIcon size={16} />
				</button>
			</div>

			<ScrollArea className="flex-1 scrollbar-hidden">
				<div className="space-y-4 p-4">
					<TimeEditor boundary={boundary} onUpdate={handleUpdateTime} />

					<div>
						<p className="text-muted-foreground text-xs mb-1.5">Spoken text</p>
						<p className="text-xs leading-relaxed">"{boundary.text}"</p>
					</div>

					{/* Actions */}
					<div className="flex flex-col gap-2">
						<Button
							size="sm"
							variant={status?.hasDirection ? "outline" : "default"}
							onClick={() => invokeAction("generate-scene-direction", { sceneId: selectedSceneId })}
						>
							<Sparkles size={14} className="mr-1.5" />
							{status?.hasDirection ? "Regenerate Direction" : "Generate Direction"}
						</Button>

						{status?.hasDirection && (
							<Button
								size="sm"
								variant={status?.hasAnimation ? "outline" : "default"}
								onClick={() => invokeAction("generate-scene-animation", { sceneId: selectedSceneId })}
							>
								<Sparkles size={14} className="mr-1.5" />
								{status?.hasAnimation ? "Regenerate Animation" : "Generate Animation"}
							</Button>
						)}

						<Button size="sm" variant="ghost" onClick={handleSeek}>
							<Play size={14} className="mr-1.5" />
							Seek to scene
						</Button>
					</div>

					{/* Direction preview */}
					{direction && (
						<div className="space-y-2">
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
										{beat.visual.length > 200 ? `${beat.visual.slice(0, 200)}...` : beat.visual}
									</p>
								</div>
							))}
						</div>
					)}

					{/* Status */}
					<div className="flex items-center gap-3 text-xs text-muted-foreground pt-1 border-t">
						<span className={status?.hasDirection ? "text-blue-400" : ""}>
							{status?.hasDirection ? "✓ Direction" : "○ No direction"}
						</span>
						<span className={status?.hasAnimation ? "text-green-400" : ""}>
							{status?.hasAnimation ? "✓ Animation" : "○ No animation"}
						</span>
					</div>
				</div>
			</ScrollArea>
		</div>
	);
}

function TimeEditor({
	boundary,
	onUpdate,
}: {
	boundary: SceneBoundary;
	onUpdate: (updates: Partial<Pick<SceneBoundary, "startTime" | "endTime">>) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [editStart, setEditStart] = useState("");
	const [editEnd, setEditEnd] = useState("");

	const startEdit = () => {
		setEditStart(boundary.startTime.toFixed(2));
		setEditEnd(boundary.endTime.toFixed(2));
		setEditing(true);
	};

	const save = () => {
		const s = Number.parseFloat(editStart);
		const e = Number.parseFloat(editEnd);
		if (!Number.isNaN(s) && !Number.isNaN(e) && e > s) {
			onUpdate({ startTime: s, endTime: e });
		}
		setEditing(false);
	};

	if (editing) {
		return (
			<div className="flex items-center gap-1.5">
				<Input value={editStart} onChange={(e) => setEditStart(e.target.value)} className="w-20 h-7 text-xs" />
				<span className="text-xs text-muted-foreground">–</span>
				<Input value={editEnd} onChange={(e) => setEditEnd(e.target.value)} className="w-20 h-7 text-xs" />
				<button type="button" onClick={save} className="text-green-500"><Check size={14} /></button>
				<button type="button" onClick={() => setEditing(false)} className="text-red-400"><XIcon size={14} /></button>
			</div>
		);
	}

	return (
		<button
			type="button"
			className="text-muted-foreground text-xs hover:text-foreground flex items-center gap-1"
			onClick={startEdit}
		>
			{boundary.startTime.toFixed(1)}s – {boundary.endTime.toFixed(1)}s
			({(boundary.endTime - boundary.startTime).toFixed(1)}s)
			<Pencil size={10} />
		</button>
	);
}
