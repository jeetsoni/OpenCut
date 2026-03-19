/**
 * Per-scene direction store backed by IndexedDB.
 * Stores one PlannedScene (with animation direction) per (project, sceneId).
 */

import { IndexedDBAdapter } from "@/services/storage/indexeddb-adapter";
import type { PlannedScene } from "./schema";

interface StoredDirection {
	_key: string;
	sceneId: number;
	direction: PlannedScene;
	createdAt: string;
}

const adapter = new IndexedDBAdapter<StoredDirection>(
	"opencut-scene-directions",
	"scene-directions",
);

function makeKey(projectId: string, sceneId: number): string {
	return `${projectId}__scene_${sceneId}`;
}

export async function getSceneDirection({
	projectId,
	sceneId,
}: {
	projectId: string;
	sceneId: number;
}): Promise<PlannedScene | null> {
	const stored = await adapter.get(makeKey(projectId, sceneId));
	return stored?.direction ?? null;
}

export async function setSceneDirection({
	projectId,
	sceneId,
	direction,
}: {
	projectId: string;
	sceneId: number;
	direction: PlannedScene;
}): Promise<void> {
	await adapter.set(makeKey(projectId, sceneId), {
		_key: makeKey(projectId, sceneId),
		sceneId,
		direction,
		createdAt: new Date().toISOString(),
	});
}

export async function deleteSceneDirection({
	projectId,
	sceneId,
}: {
	projectId: string;
	sceneId: number;
}): Promise<void> {
	await adapter.remove(makeKey(projectId, sceneId));
}
