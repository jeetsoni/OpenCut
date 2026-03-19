/**
 * Persistent store for scene boundaries, backed by IndexedDB.
 * Stores one SceneBoundaries per project.
 */

import { IndexedDBAdapter } from "@/services/storage/indexeddb-adapter";
import type { SceneBoundaries } from "./boundaries";

interface StoredBoundaries extends SceneBoundaries {
	id: string;
	createdAt: string;
}

const adapter = new IndexedDBAdapter<StoredBoundaries>(
	"opencut-scene-boundaries",
	"scene-boundaries",
);

export async function getProjectBoundaries({
	projectId,
}: {
	projectId: string;
}): Promise<SceneBoundaries | null> {
	return adapter.get(projectId);
}

export async function setProjectBoundaries({
	projectId,
	boundaries,
}: {
	projectId: string;
	boundaries: SceneBoundaries;
}): Promise<void> {
	await adapter.set(projectId, {
		...boundaries,
		id: projectId,
		createdAt: new Date().toISOString(),
	});
}

export async function deleteProjectBoundaries({
	projectId,
}: {
	projectId: string;
}): Promise<void> {
	await adapter.remove(projectId);
}
