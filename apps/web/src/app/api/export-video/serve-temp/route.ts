/**
 * GET /api/export-video/serve-temp?file=opencut-face-xxx.mp4
 *
 * Streams a file from the OS temp directory by filename.
 * Used to give Remotion's headless Chromium an HTTP URL for the
 * face cam video instead of a file:// URL (which Chromium blocks).
 *
 * Security: only files whose basename starts with "opencut-" are served.
 */

import { type NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export async function GET(request: NextRequest) {
	const filename = request.nextUrl.searchParams.get("file");

	if (!filename || path.basename(filename) !== filename) {
		return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
	}

	// Only serve files we created
	if (!filename.startsWith("opencut-")) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const filePath = path.join(os.tmpdir(), filename);

	if (!fs.existsSync(filePath)) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	const stat = fs.statSync(filePath);
	const fileBuffer = fs.readFileSync(filePath);

	return new NextResponse(fileBuffer, {
		headers: {
			"Content-Type": "video/mp4",
			"Content-Length": String(stat.size),
			"Cache-Control": "no-store",
		},
	});
}
