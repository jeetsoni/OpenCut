/**
 * Persistent store for generated Remotion code, backed by IndexedDB.
 *
 * Stores one code string per project ID so generated animations
 * survive page reloads and can be previewed/edited.
 */

import { IndexedDBAdapter } from "@/services/storage/indexeddb-adapter";

interface StoredRemotionCode {
	id: string;
	code: string;
	createdAt: string;
}

const adapter = new IndexedDBAdapter<StoredRemotionCode>(
	"opencut-remotion-code",
	"remotion-code",
);

export async function getProjectRemotionCode({
	projectId,
}: {
	projectId: string;
}): Promise<{ code: string; createdAt: string } | null> {
	return adapter.get(projectId);
}

export async function setProjectRemotionCode({
	projectId,
	code,
}: {
	projectId: string;
	code: string;
}): Promise<void> {
	await adapter.set(projectId, {
		id: projectId,
		code,
		createdAt: new Date().toISOString(),
	});
}

export async function deleteProjectRemotionCode({
	projectId,
}: {
	projectId: string;
}): Promise<void> {
	await adapter.remove(projectId);
}
