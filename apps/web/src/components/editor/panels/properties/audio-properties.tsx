import type { AudioElement } from "@/types/timeline";
import { VolumeSection } from "./sections";

export function AudioProperties({
	element,
	trackId,
}: {
	element: AudioElement;
	trackId: string;
}) {
	return (
		<div className="flex h-full flex-col">
			<VolumeSection element={element} trackId={trackId} />
		</div>
	);
}
