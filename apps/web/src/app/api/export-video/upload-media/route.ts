/**
 * POST /api/export-video/upload-media
 *
 * Receives media files via multipart form data and stores them
 * in a temp directory for the export pipeline. Returns a map
 * of mediaId → server file path.
 */

import { type NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
	try {
		const formData = await request.formData();
		const exportDir = path.join(os.tmpdir(), `opencut-export-${Date.now()}`);
		fs.mkdirSync(exportDir, { recursive: true });

		const files: Record<string, string> = {};

		const entries = Array.from(formData.entries());
		for (const [mediaId, value] of entries) {
			if (typeof value === "string") continue;

			// value is a File (Blob with name)
			const file = value as unknown as { name: string; arrayBuffer(): Promise<ArrayBuffer> };
			const ext = path.extname(file.name) || ".bin";
			const safeName = `${mediaId}${ext}`;
			const filePath = path.join(exportDir, safeName);

			const arrayBuffer = await file.arrayBuffer();
			fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

			files[mediaId] = filePath;
		}

		return NextResponse.json({ files, exportDir });
	} catch (error) {
		console.error("[upload-media] Failed:", error);
		const message = error instanceof Error ? error.message : "Upload failed";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
