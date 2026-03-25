/**
 * Langfuse observability for client-side AI SDK calls.
 *
 * All LLM calls run client-side (API key in localStorage). This wrapper
 * sends trace data to /api/langfuse-trace after each call completes.
 * The POST is fire-and-forget — it never blocks or fails the LLM call.
 *
 * The server-side route uses LANGFUSE_SECRET_KEY to write traces to Langfuse.
 */

import { generateText } from "ai";

export interface LangfuseTraceOptions {
	/** Operation name shown in Langfuse, e.g. "detect-boundaries" */
	name: string;
	/** Optional extra metadata attached to the trace */
	metadata?: Record<string, unknown>;
}

/**
 * Loose param type that avoids the `never` collapse TypeScript produces when
 * instantiating the AI SDK's constrained generics with `any`.
 */
interface GenerateTextInput {
	// biome-ignore lint/suspicious/noExplicitAny: pass-through wrapper
	model: any;
	system?: string;
	prompt?: string;
	// biome-ignore lint/suspicious/noExplicitAny: pass-through wrapper
	messages?: any[];
	temperature?: number;
	// biome-ignore lint/suspicious/noExplicitAny: pass-through wrapper
	tools?: any;
	// biome-ignore lint/suspicious/noExplicitAny: pass-through wrapper
	stopWhen?: any;
	// biome-ignore lint/suspicious/noExplicitAny: pass-through wrapper
	[key: string]: any;
}

/**
 * Returns (or lazily creates) a stable session ID for the current browser tab.
 */
function getSessionId(): string {
	if (typeof sessionStorage === "undefined") return "server";
	let id = sessionStorage.getItem("lf-session-id");
	if (!id) {
		id = crypto.randomUUID();
		sessionStorage.setItem("lf-session-id", id);
	}
	return id;
}

/**
 * Drop-in replacement for `generateText` that traces to Langfuse
 * via the server-side /api/langfuse-trace endpoint.
 */
export async function tracedGenerateText(
	params: GenerateTextInput & { langfuse: LangfuseTraceOptions },
) {
	const { langfuse: lfOpts, ...generateParams } = params;

	// biome-ignore lint/suspicious/noExplicitAny: pass-through wrapper
	const result = await generateText(generateParams as Parameters<typeof generateText>[0]);

	const modelId: string = generateParams.model?.modelId ?? "unknown";

	const payload = {
		name: lfOpts.name,
		sessionId: getSessionId(),
		modelId,
		metadata: lfOpts.metadata,
		usage: result.usage
			? {
					inputTokens: result.usage.inputTokens ?? 0,
					outputTokens: result.usage.outputTokens ?? 0,
					totalTokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
				}
			: undefined,
		input: typeof generateParams.prompt === "string"
			? generateParams.prompt.slice(0, 3000)
			: typeof generateParams.system === "string"
				? generateParams.system.slice(0, 3000)
				: undefined,
		output: result.text?.slice(0, 3000),
	};

	// Fire-and-forget — errors are swallowed so tracing never affects the user
	void fetch("/api/langfuse-trace", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	}).catch(() => {});

	return result;
}
