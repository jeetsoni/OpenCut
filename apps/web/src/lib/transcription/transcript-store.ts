/**
 * Persistent transcript store backed by IndexedDB.
 *
 * Stores one ProjectTranscript per project ID so the word-level
 * transcript survives page reloads and can be reused by the
 * scene planner, captions, and other downstream features.
 */

import { IndexedDBAdapter } from "@/services/storage/indexeddb-adapter";
import type { ProjectTranscript } from "@/types/transcription";

interface StoredTranscript extends ProjectTranscript {
	id: string;
}

const adapter = new IndexedDBAdapter<StoredTranscript>(
	"opencut-project-transcripts",
	"transcripts",
);

export async function getProjectTranscript({
	projectId,
}: {
	projectId: string;
}): Promise<ProjectTranscript | null> {
	return adapter.get(projectId);
}

export async function setProjectTranscript({
	projectId,
	transcript,
}: {
	projectId: string;
	transcript: ProjectTranscript;
}): Promise<void> {
	await adapter.set(projectId, { ...transcript, id: projectId });
}

export async function deleteProjectTranscript({
	projectId,
}: {
	projectId: string;
}): Promise<void> {
	await adapter.remove(projectId);
}
