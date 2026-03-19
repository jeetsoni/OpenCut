"use client";

import { useEditor } from "@/hooks/use-editor";
import { clamp } from "@/utils/math";
import { NumberField } from "@/components/ui/number-field";
import { Slider } from "@/components/ui/slider";
import { HugeiconsIcon } from "@hugeicons/react";
import { VolumeHighIcon, VolumeMute02Icon } from "@hugeicons/core-free-icons";
import {
	Section,
	SectionContent,
	SectionField,
	SectionHeader,
	SectionTitle,
} from "../section";
import type { AudioElement } from "@/types/timeline";
import { useState } from "react";

export function VolumeSection({
	element,
	trackId,
}: {
	element: AudioElement;
	trackId: string;
}) {
	const editor = useEditor();
	const [localValue, setLocalValue] = useState<string | null>(null);
	const displayPercent = Math.round(element.volume * 100);

	const commitVolume = (normalized: number) => {
		const clamped = clamp({ value: normalized, min: 0, max: 2 });
		editor.timeline.updateElements({
			updates: [
				{ trackId, elementId: element.id, updates: { volume: clamped } },
			],
		});
	};

	return (
		<Section collapsible sectionKey={`${element.id}:volume`}>
			<SectionHeader>
				<SectionTitle>Volume</SectionTitle>
			</SectionHeader>
			<SectionContent>
				<div className="flex flex-col gap-3">
					<div className="flex items-center gap-3">
						<button
							type="button"
							className="text-muted-foreground hover:text-foreground shrink-0"
							onClick={() => {
								editor.timeline.updateElements({
									updates: [
										{
											trackId,
											elementId: element.id,
											updates: { muted: !element.muted },
										},
									],
								});
							}}
							title={element.muted ? "Unmute" : "Mute"}
						>
							<HugeiconsIcon
								icon={element.muted ? VolumeMute02Icon : VolumeHighIcon}
								size={16}
							/>
						</button>
						<Slider
							min={0}
							max={200}
							step={1}
							value={[displayPercent]}
							onValueChange={([v]) => commitVolume(v / 100)}
							className="flex-1"
						/>
						<SectionField label="" className="w-16 shrink-0">
							<NumberField
								className="w-full"
								value={localValue ?? displayPercent.toString()}
								min={0}
								max={200}
								onFocus={() => setLocalValue(displayPercent.toString())}
								onChange={(e) => setLocalValue(e.target.value)}
								onBlur={() => {
									if (localValue != null) {
										const parsed = parseFloat(localValue);
										if (!Number.isNaN(parsed)) {
											commitVolume(clamp({ value: parsed, min: 0, max: 200 }) / 100);
										}
									}
									setLocalValue(null);
								}}
								onReset={() => commitVolume(1)}
								isDefault={element.volume === 1}
								dragSensitivity="slow"
							/>
						</SectionField>
					</div>
				</div>
			</SectionContent>
		</Section>
	);
}
