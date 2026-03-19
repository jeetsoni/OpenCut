"use client";

import { useEffect } from "react";
import { useEditor } from "@/hooks/use-editor";
import { useSceneStore } from "@/stores/scene-store";
import type { SceneBoundary } from "@/lib/scene-planner/boundaries";
import { timelineTimeToPixels } from "@/lib/timeline";

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

interface SceneBoundariesRowProps {
	zoomLevel: number;
	dynamicTimelineWidth: number;
}

export function SceneBoundariesRow({
	zoomLevel,
	dynamicTimelineWidth,
}: SceneBoundariesRowProps) {
	const editor = useEditor();
	const projectId = editor.project.getActive()?.metadata.id;
	const boundaries = useSceneStore((s) => s.boundaries);
	const selectedSceneId = useSceneStore((s) => s.selectedSceneId);
	const selectScene = useSceneStore((s) => s.selectScene);
	const setBoundaries = useSceneStore((s) => s.setBoundaries);
	const loadBoundaries = useSceneStore((s) => s.loadBoundaries);

	// Load boundaries once on mount / project change
	useEffect(() => {
		if (projectId) loadBoundaries(projectId);
	}, [projectId, loadBoundaries]);

	if (!boundaries || boundaries.boundaries.length === 0) return null;
	const handleDragBoundary = (
		sceneId: number,
		edge: "start" | "end",
		newTime: number,
	) => {
		if (!projectId) return;
		const updated = {
			...boundaries,
			boundaries: boundaries.boundaries.map((b) => {
				if (b.id !== sceneId) return b;
				if (edge === "start") return { ...b, startTime: Math.max(0, newTime) };
				return { ...b, endTime: Math.max(b.startTime + 0.1, newTime) };
			}),
		};
		setBoundaries(projectId, updated);
	};

	return (
		<div className="relative h-7 flex-1 overflow-hidden border-b border-border/50">
			<div
				className="relative h-full"
				style={{ width: `${dynamicTimelineWidth}px` }}
			>
				{boundaries.boundaries.map((boundary) => {
					const leftPx = timelineTimeToPixels({
						time: boundary.startTime,
						zoomLevel,
					});
					const rightPx = timelineTimeToPixels({
						time: boundary.endTime,
						zoomLevel,
					});
					const widthPx = Math.max(rightPx - leftPx, 4);
					const color = SCENE_TYPE_COLORS[boundary.type] || "#5BB8F5";

					return (
						<SceneBoundaryMarker
							key={boundary.id}
							boundary={boundary}
							leftPx={leftPx}
							widthPx={widthPx}
							color={color}
							zoomLevel={zoomLevel}
							isSelected={boundary.id === selectedSceneId}
							onSelect={() => selectScene(boundary.id)}
							onDrag={handleDragBoundary}
						/>
					);
				})}
			</div>
		</div>
	);
}

function SceneBoundaryMarker({
	boundary,
	leftPx,
	widthPx,
	color,
	zoomLevel,
	isSelected,
	onSelect,
	onDrag,
}: {
	boundary: SceneBoundary;
	leftPx: number;
	widthPx: number;
	color: string;
	zoomLevel: number;
	isSelected: boolean;
	onSelect: () => void;
	onDrag: (sceneId: number, edge: "start" | "end", newTime: number) => void;
}) {
	const editor = useEditor();

	const handleEdgeDrag = (edge: "start" | "end") => (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();

		const startX = e.clientX;
		const startTime = edge === "start" ? boundary.startTime : boundary.endTime;

		const handleMouseMove = (moveEvent: MouseEvent) => {
			const deltaX = moveEvent.clientX - startX;
			const deltaTime = deltaX / (zoomLevel * 100);
			onDrag(boundary.id, edge, startTime + deltaTime);
		};

		const handleMouseUp = () => {
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", handleMouseUp);
		};

		document.addEventListener("mousemove", handleMouseMove);
		document.addEventListener("mouseup", handleMouseUp);
	};

	const handleClick = () => {
		editor.playback.seek({ time: boundary.startTime });
		onSelect();
	};

	return (
		<div
			className="absolute top-0 h-full group cursor-pointer"
			style={{ left: leftPx, width: widthPx }}
			onClick={handleClick}
			title={`${boundary.name} (${boundary.type})`}
		>
			<div
				className="absolute inset-0 rounded-sm transition-all"
				style={{
					backgroundColor: color,
					opacity: isSelected ? 0.65 : 0.35,
					boxShadow: isSelected ? `0 0 0 1.5px ${color}` : "none",
				}}
			/>
			{/* Separator line at left edge */}
			<div
				className="absolute top-0 left-0 w-px h-full"
				style={{ backgroundColor: color, opacity: 0.8 }}
			/>
			<div
				className="absolute top-0 left-1.5 right-1 flex items-center h-full pointer-events-none"
			>
				<span
					className="text-[10px] font-semibold truncate leading-none"
					style={{ color: isSelected ? "#fff" : color, maxWidth: widthPx - 16 }}
				>
					{boundary.name}
				</span>
			</div>
			<div
				className="absolute top-0 left-0 w-2 h-full cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity"
				style={{ backgroundColor: color }}
				onMouseDown={handleEdgeDrag("start")}
			/>
			<div
				className="absolute top-0 right-0 w-2 h-full cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity"
				style={{ backgroundColor: color }}
				onMouseDown={handleEdgeDrag("end")}
			/>
		</div>
	);
}

/**
 * Label for the left column, matching the scene boundaries row height.
 * Only renders when boundaries exist.
 */
export function SceneBoundariesLabel() {
	const boundaries = useSceneStore((s) => s.boundaries);
	if (!boundaries || boundaries.boundaries.length === 0) return null;

	return (
		<div className="bg-background flex h-7 items-center justify-end px-3 border-b border-border/50">
			<span className="text-muted-foreground text-[10px] font-medium">Scenes</span>
		</div>
	);
}
