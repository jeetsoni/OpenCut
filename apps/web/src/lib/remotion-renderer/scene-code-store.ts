/**
 * Per-scene Remotion code store backed by IndexedDB.
 *
 * Stores one code string per (project, sceneId) pair so each
 * scene's animation can be generated and previewed independently.
 */

import { IndexedDBAdapter } from "@/services/storage/indexeddb-adapter";

interface StoredSceneCode {
	id: string;
	code: string;
	sceneId: number;
	createdAt: string;
}

const adapter = new IndexedDBAdapter<StoredSceneCode>(
	"opencut-scene-remotion-code",
	"scene-remotion-code",
);

function makeKey(projectId: string, sceneId: number): string {
	return `${projectId}__scene_${sceneId}`;
}

export async function getSceneRemotionCode({
	projectId,
	sceneId,
}: {
	projectId: string;
	sceneId: number;
}): Promise<{ code: string; createdAt: string } | null> {
	return adapter.get(makeKey(projectId, sceneId));
}

export async function setSceneRemotionCode({
	projectId,
	sceneId,
	code,
}: {
	projectId: string;
	sceneId: number;
	code: string;
}): Promise<void> {
	await adapter.set(makeKey(projectId, sceneId), {
		id: makeKey(projectId, sceneId),
		sceneId,
		code,
		createdAt: new Date().toISOString(),
	});
}

export async function deleteSceneRemotionCode({
	projectId,
	sceneId,
}: {
	projectId: string;
	sceneId: number;
}): Promise<void> {
	await adapter.remove(makeKey(projectId, sceneId));
}
