/**
 * Shared code-editor AI tools for Remotion component agents.
 *
 * Three agents (tweak, layout-review, vision-fix) all need the same
 * `read_code` / `edit_code` tool pair. This module defines them once
 * via a factory that closes over a mutable code reference.
 */

import { tool } from "ai";
import { z } from "zod";

/**
 * Apply a single string replacement to `code`.
 * Returns the updated code on success, or a descriptive error string the LLM
 * can use to self-correct on the next step.
 */
export function applyEdit(
	code: string,
	oldStr: string,
	newStr: string,
): { ok: true; code: string } | { ok: false; error: string } {
	if (oldStr === newStr) {
		return { ok: false, error: "oldStr and newStr are identical — nothing to change." };
	}

	const idx = code.indexOf(oldStr);
	if (idx === -1) {
		const preview = code.split("\n").slice(0, 5).join("\n");
		return {
			ok: false,
			error: `oldStr not found in code. Make sure it matches exactly (whitespace matters). First 5 lines of current code:\n${preview}`,
		};
	}

	const secondIdx = code.indexOf(oldStr, idx + 1);
	if (secondIdx !== -1) {
		return {
			ok: false,
			error: `oldStr matches multiple locations (at index ${idx} and ${secondIdx}). Include more surrounding context to make it unique.`,
		};
	}

	return { ok: true, code: code.slice(0, idx) + newStr + code.slice(idx + oldStr.length) };
}

/**
 * Create a `read_code` + `edit_code` tool pair that operate on a shared code
 * string via getter/setter closures.
 *
 * Usage:
 * ```ts
 * let currentCode = initialCode;
 * const tools = createCodeEditorTools(
 *   () => currentCode,
 *   (c) => { currentCode = c; },
 * );
 * await generateText({ model, tools, ... });
 * ```
 */
export function createCodeEditorTools(
	getCode: () => string,
	setCode: (code: string) => void,
) {
	return {
		read_code: tool({
			description: "Read the current animation code. Always call this first before making edits.",
			inputSchema: z.object({}),
			execute: async () => ({ code: getCode() }),
		}),
		edit_code: tool({
			description:
				"Replace an exact substring in the animation code. oldStr must match exactly (whitespace-sensitive). Returns success or an error message to help you retry.",
			inputSchema: z.object({
				oldStr: z.string().describe("The exact substring to find and replace"),
				newStr: z.string().describe("The replacement string"),
			}),
			execute: async ({ oldStr, newStr }: { oldStr: string; newStr: string }) => {
				const result = applyEdit(getCode(), oldStr, newStr);
				if (result.ok) {
					setCode(result.code);
					return { success: true, message: "Edit applied successfully." };
				}
				return { success: false, message: result.error };
			},
		}),
	};
}
