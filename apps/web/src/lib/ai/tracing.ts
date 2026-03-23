/**
 * Langfuse observability wrapper for Vercel AI SDK generateText calls.
 *
 * All LLM calls in this project run client-side (the API key is stored in
 * localStorage). To keep LANGFUSE_SECRET_KEY server-side only, this wrapper
 * fires a POST to /api/langfuse-trace after each call completes.  The POST
 * is fire-and-forget — it never blocks or fails the LLM call itself.
 *
 * Each call gets its own Langfuse trace. Calls from the same browser tab
 * are grouped under a shared session ID (stored in sessionStorage) so you
 * can see the total cost for one "generate animations" run in Langfuse.
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
 * We cast to `Parameters<typeof generateText>[0]` internally before calling.
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
 * All generateText calls within the same tab session share this ID so
 * Langfuse can group them into one session for cost aggregation.
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
 * Drop-in replacement for `generateText` that traces token usage to Langfuse.
 *
 * Usage:
 * ```ts
 * const result = await tracedGenerateText({
 *   model,
 *   system: SYSTEM_PROMPT,
 *   prompt: userPrompt,
 *   temperature: 0.4,
 *   langfuse: { name: "detect-boundaries" },
 * });
 * ```
 */
export async function tracedGenerateText(
	params: GenerateTextInput & { langfuse: LangfuseTraceOptions },
) {
	const { langfuse: lfOpts, ...generateParams } = params;

	// biome-ignore lint/suspicious/noExplicitAny: pass-through — callers have full type safety from their own usage
	const result = await generateText(generateParams as Parameters<typeof generateText>[0]);

	const modelId: string = generateParams.model?.modelId ?? "unknown";

	// Build the input summary — handles both prompt: string and messages: array shapes
	let inputSummary: string;
	if (Array.isArray(generateParams.messages)) {
		const lastUser = [...generateParams.messages].reverse().find((m: { role: string }) => m.role === "user");
		const textPart = Array.isArray(lastUser?.content)
			? lastUser.content.find((c: { type: string }) => c.type === "text")?.text ?? ""
			: String(lastUser?.content ?? "");
		inputSummary = typeof generateParams.system === "string"
			? `[system]\n${generateParams.system.slice(0, 800)}\n\n[user]\n${textPart.slice(0, 800)}`
			: textPart.slice(0, 1600);
	} else {
		inputSummary = typeof generateParams.system === "string"
			? `[system]\n${generateParams.system.slice(0, 1500)}\n\n[user]\n${String(generateParams.prompt ?? "").slice(0, 1500)}`
			: String(generateParams.prompt ?? "").slice(0, 3000);
	}

	const payload = {
		name: lfOpts.name,
		sessionId: getSessionId(),
		modelId,
		metadata: lfOpts.metadata,
		usage: result.usage
			? {
					promptTokens: result.usage.promptTokens,
					completionTokens: result.usage.completionTokens,
					totalTokens: result.usage.totalTokens,
				}
			: undefined,
		input: inputSummary,
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
