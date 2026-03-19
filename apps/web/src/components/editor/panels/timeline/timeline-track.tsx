"use client";

import { useMemo } from "react";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import { TimelineElement } from "./timeline-element";
import type { TimelineTrack } from "@/types/timeline";
import type { TimelineElement as TimelineElementType } from "@/types/timeline";
import type { SnapPoint } from "@/lib/timeline/snap-utils";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { useEdgeAutoScroll } from "@/hooks/timeline/use-edge-auto-scroll";
import type { ElementDragState } from "@/types/timeline";
import { useEditor } from "@/hooks/use-editor";
import { useSceneStore } from "@/stores/scene-store";
import { timelineTimeToPixels } from "@/lib/timeline";

interface TimelineTrackContentProps {
	track: TimelineTrack;
	zoomLevel: number;
	dragState: ElementDragState;
	rulerScrollRef: React.RefObject<HTMLDivElement | null>;
	tracksScrollRef: React.RefObject<HTMLDivElement | null>;
	lastMouseXRef: React.RefObject<number>;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
	onResizeStateChange?: (params: { isResizing: boolean }) => void;
	onElementMouseDown: (params: {
		event: React.MouseEvent;
		element: TimelineElementType;
		track: TimelineTrack;
	}) => void;
	onElementClick: (params: {
		event: React.MouseEvent;
		element: TimelineElementType;
		track: TimelineTrack;
	}) => void;
	onTrackMouseDown?: (event: React.MouseEvent) => void;
	onTrackClick?: (event: React.MouseEvent) => void;
	shouldIgnoreClick?: () => boolean;
	targetElementId?: string | null;
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

interface SceneGroup {
	sceneId: number;
	color: string;
	leftPx: number;
	widthPx: number;
}

export function TimelineTrackContent({
	track,
	zoomLevel,
	dragState,
	rulerScrollRef,
	tracksScrollRef,
	lastMouseXRef,
	onSnapPointChange,
	onResizeStateChange,
	onElementMouseDown,
	onElementClick,
	onTrackMouseDown,
	onTrackClick,
	shouldIgnoreClick,
	targetElementId = null,
}: TimelineTrackContentProps) {
	const editor = useEditor();
	const { isElementSelected } = useElementSelection();
	const elementSceneMap = useSceneStore((s) => s.elementSceneMap);
	const boundaries = useSceneStore((s) => s.boundaries);

	const duration = editor.timeline.getTotalDuration();

	useEdgeAutoScroll({
		isActive: dragState.isDragging,
		getMouseClientX: () => lastMouseXRef.current ?? 0,
		rulerScrollRef,
		tracksScrollRef,
		contentWidth: duration * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel,
	});

	// Compute scene groups: consecutive elements sharing the same scene get
	// a single colored border overlay. Only groups with 2+ elements show.
	const sceneGroups = useMemo<SceneGroup[]>(() => {
		if (!boundaries || Object.keys(elementSceneMap).length === 0) return [];

		const sorted = [...track.elements].sort(
			(a, b) => a.startTime - b.startTime,
		);

		const groups: SceneGroup[] = [];
		let groupStart = 0;

		for (let i = 1; i <= sorted.length; i++) {
			const prevSceneId = elementSceneMap[sorted[i - 1].id];
			const currSceneId = i < sorted.length ? elementSceneMap[sorted[i].id] : undefined;

			if (currSceneId === prevSceneId && currSceneId !== undefined) continue;

			// End of a run — only create a group if it has 2+ elements
			const groupLen = i - groupStart;
			if (groupLen >= 2 && prevSceneId !== undefined) {
				const first = sorted[groupStart];
				const last = sorted[i - 1];
				const boundary = boundaries.boundaries.find((b) => b.id === prevSceneId);
				const color = boundary ? (SCENE_TYPE_COLORS[boundary.type] || "#5BB8F5") : "#5BB8F5";

				const leftPx = timelineTimeToPixels({ time: first.startTime, zoomLevel });
				const rightPx = timelineTimeToPixels({
					time: last.startTime + last.duration,
					zoomLevel,
				});

				groups.push({
					sceneId: prevSceneId,
					color,
					leftPx,
					widthPx: rightPx - leftPx,
				});
			}

			groupStart = i;
		}

		return groups;
	}, [track.elements, elementSceneMap, boundaries, zoomLevel]);

	return (
		<button
			className="size-full"
			onClick={(event) => {
				if (shouldIgnoreClick?.()) return;
				onTrackClick?.(event);
			}}
			onMouseDown={(event) => {
				event.preventDefault();
				onTrackMouseDown?.(event);
			}}
			type="button"
		>
			<div className="relative h-full min-w-full">
				{track.elements.length === 0 ? (
					<div className="text-muted-foreground border-muted/30 flex size-full items-center justify-center rounded-sm border-2 border-dashed text-xs" />
				) : (
					<>
						{sceneGroups.map((group) => (
							<div
								key={`scene-group-${group.sceneId}`}
								className="absolute top-0 h-full pointer-events-none rounded-sm"
								style={{
									left: group.leftPx,
									width: group.widthPx,
									border: `1.5px solid ${group.color}`,
									opacity: 0.7,
								}}
							/>
						))}
						{track.elements.map((element) => {
							const isSelected = isElementSelected({
								trackId: track.id,
								elementId: element.id,
							});

							return (
								<TimelineElement
									key={element.id}
									element={element}
									track={track}
									zoomLevel={zoomLevel}
									isSelected={isSelected}
									onSnapPointChange={onSnapPointChange}
									onResizeStateChange={onResizeStateChange}
									onElementMouseDown={(event, element) =>
										onElementMouseDown({ event, element, track })
									}
									onElementClick={(event, element) =>
										onElementClick({ event, element, track })
									}
									dragState={dragState}
									isDropTarget={element.id === targetElementId}
								/>
							);
						})}
					</>
				)}
			</div>
		</button>
	);
}
