/**
 * POST /api/langfuse-trace
 *
 * Receives token-usage data from client-side LLM calls and writes a
 * Langfuse trace + generation server-side using the secret key.
 *
 * This indirection keeps LANGFUSE_SECRET_KEY out of the browser bundle.
 * The endpoint always returns 200 — tracing failures must never surface
 * to the user.
 */

import { type NextRequest, NextResponse } from "next/server";
import { Langfuse } from "langfuse";

// Singleton — reused across requests in the same serverless instance.
let _lf: Langfuse | null = null;

function getLangfuse(): Langfuse | null {
	const secretKey = process.env.LANGFUSE_SECRET_KEY;
	const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
	if (!secretKey || !publicKey) return null;

	if (!_lf) {
		_lf = new Langfuse({
			secretKey,
			publicKey,
			baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
			// Flush immediately — serverless functions don't stay alive
			flushAt: 1,
			flushInterval: 0,
		});
	}
	return _lf;
}

interface TracePayload {
	name: string;
	sessionId?: string;
	modelId: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	input?: string;
	output?: string;
	metadata?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
	try {
		const lf = getLangfuse();
		if (!lf) {
			// Langfuse not configured — silently succeed so the client isn't blocked
			return NextResponse.json({ ok: false, reason: "not configured" });
		}

		const body = (await request.json()) as TracePayload;
		const { name, sessionId, modelId, usage, input, output, metadata } = body;

		const trace = lf.trace({
			name,
			sessionId,
			metadata: {
				...metadata,
				modelId,
			},
		});

		trace.generation({
			name,
			model: modelId,
			input,
			output,
			usage: usage
				? {
						input: usage.promptTokens,
						output: usage.completionTokens,
						total: usage.totalTokens,
						unit: "TOKENS",
					}
				: undefined,
		});

		// Must flush before the serverless function exits
		await lf.flushAsync();

		return NextResponse.json({ ok: true });
	} catch (err) {
		// Log server-side but always return 200 to the client
		console.warn("[langfuse-trace] Failed to send trace:", err);
		return NextResponse.json({ ok: false });
	}
}
