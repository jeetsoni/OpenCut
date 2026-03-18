/**
 * Persistent scene plan store backed by IndexedDB.
 *
 * Stores one ScenePlan per project ID so the generated scenes
 * survive page reloads and can be reviewed/edited by the user.
 */

import { IndexedDBAdapter } from "@/services/storage/indexeddb-adapter";
import type { ScenePlan } from "./schema";

interface StoredScenePlan extends ScenePlan {
	id: string;
	createdAt: string;
}

const adapter = new IndexedDBAdapter<StoredScenePlan>(
	"opencut-scene-plans",
	"scene-plans",
);

export async function getProjectScenePlan({
	projectId,
}: {
	projectId: string;
}): Promise<(ScenePlan & { createdAt: string }) | null> {
	return adapter.get(projectId);
}

export async function setProjectScenePlan({
	projectId,
	scenePlan,
}: {
	projectId: string;
	scenePlan: ScenePlan;
}): Promise<void> {
	await adapter.set(projectId, {
		...scenePlan,
		id: projectId,
		createdAt: new Date().toISOString(),
	});
}

export async function deleteProjectScenePlan({
	projectId,
}: {
	projectId: string;
}): Promise<void> {
	await adapter.remove(projectId);
}
