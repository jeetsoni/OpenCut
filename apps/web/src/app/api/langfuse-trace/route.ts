/**
 * POST /api/langfuse-trace
 *
 * Receives trace data from client-side LLM calls and writes to Langfuse
 * server-side using the secret key.
 *
 * This keeps LANGFUSE_SECRET_KEY out of the browser bundle.
 * Always returns 200 — tracing failures must never surface to the user.
 */

import { type NextRequest, NextResponse } from "next/server";
import Langfuse from "langfuse";

interface TracePayload {
	name: string;
	sessionId?: string;
	modelId: string;
	usage?: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
	input?: string;
	output?: string;
	metadata?: Record<string, unknown>;
	tags?: string[];
}

export async function POST(request: NextRequest) {
	try {
		const secretKey = process.env.LANGFUSE_SECRET_KEY;
		const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
		if (!secretKey || !publicKey) {
			console.warn("[langfuse-trace] Missing LANGFUSE_SECRET_KEY or LANGFUSE_PUBLIC_KEY");
			return NextResponse.json({ ok: false, reason: "not configured" });
		}

		const body = (await request.json()) as TracePayload;
		const { name, sessionId, modelId, usage, input, output, metadata, tags } = body;

		// Create a fresh instance per request to ensure clean flush in serverless
		const lf = new Langfuse({
			secretKey,
			publicKey,
			baseUrl: process.env.LANGFUSE_BASEURL ?? "https://cloud.langfuse.com",
		});

		const trace = lf.trace({
			name,
			sessionId,
			metadata: { ...metadata, modelId },
			tags: tags ?? [],
		});

		trace.generation({
			name,
			model: modelId,
			input,
			output,
			usage: usage
				? {
						input: usage.inputTokens,
						output: usage.outputTokens,
						total: usage.totalTokens,
						unit: "TOKENS",
					}
				: undefined,
		});

		// Must flush before the serverless function exits
		await lf.shutdownAsync();

		return NextResponse.json({ ok: true });
	} catch (err) {
		console.warn("[langfuse-trace] Failed to send trace:", err);
		return NextResponse.json({ ok: false });
	}
}
