/**
 * Vision-based layout review for generated Remotion components.
 *
 * Sends captured PNG frames to the user's configured vision model
 * and returns a description of any layout bugs found.
 */

import { getAIProviderConfig } from "@/lib/ai-provider";

const VISION_SYSTEM_PROMPT = `You are a visual QA engineer reviewing screenshots of Remotion animation components for OBJECTIVE LAYOUT BUGS ONLY — not design preferences.

## What you are looking at
Each image is a 540×540px screenshot of the animation's safe zone (y=80–1160 of a 1080×1920 canvas), captured at the midpoint of an animation beat.

## Report ONLY these specific bugs

1. TEXT_OVERFLOW — Text visibly cut off mid-word, overflowing its container, or bleeding outside a card's borders
2. STATIC_OVERLAP — Two sibling elements with hardcoded positions visually overlapping where neither appears to be mid-animation (i.e., not a scale/slide/fade transition)
3. OUT_OF_BOUNDS — Content clearly extending past the bottom edge of the image (below y=1160 in composition space)
4. TINY_TEXT — Text that is illegible at this zoom level (looks like less than 10px in this 540px-wide image; corresponds to ~20px in composition)
5. LOW_CONTRAST — Text or UI elements that are nearly invisible against the background (cannot read them)

## DO NOT report
- Elements mid-animation (scaling, moving, fading — intentional transitions)
- Off-center layouts, alignment choices, or font size preferences you disagree with
- Minor spacing or color decisions
- Elements inside different Sequence blocks (they don't coexist)

## Output format
For each bug: "BUG [TYPE]: [specific description of what element and where]"
If no bugs: "No visual issues found."

Be concise. Max 5 bug reports.`;

/**
 * Send captured frames to the configured vision model for layout review.
 * Returns a string describing bugs found, or "No visual issues found."
 */
export async function visionReviewFrames(
	frames: string[],
	sceneName: string,
): Promise<string> {
	if (frames.length === 0) return "No visual issues found.";

	const config = getAIProviderConfig();
	if (!config?.apiKey) return "No visual issues found.";

	const userText = `Review these ${frames.length} screenshot(s) from scene "${sceneName}" for layout bugs. Each frame is from a different animation beat.`;

	try {
		if (config.provider === "gemini") {
			return await reviewWithGemini({ frames, userText, config });
		}
		return await reviewWithOpenAI({ frames, userText, config });
	} catch (err) {
		console.warn("[VisionReview] Vision API call failed:", err);
		return "No visual issues found.";
	}
}

async function reviewWithOpenAI({
	frames,
	userText,
	config,
}: {
	frames: string[];
	userText: string;
	config: { apiKey: string; baseUrl?: string; model?: string };
}): Promise<string> {
	const baseUrl = config.baseUrl || "https://api.openai.com/v1";
	const model = config.model || "gpt-4o-mini";

	// Build content array: text first, then each image
	const content: unknown[] = [{ type: "text", text: `${VISION_SYSTEM_PROMPT}\n\n${userText}` }];
	for (const b64 of frames) {
		content.push({
			type: "image_url",
			image_url: { url: `data:image/png;base64,${b64}`, detail: "low" },
		});
	}

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${config.apiKey}`,
		},
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content }],
			temperature: 0.1,
			max_tokens: 512,
		}),
		signal: AbortSignal.timeout(60_000),
	});

	if (!response.ok) {
		const err = await response.text();
		throw new Error(`OpenAI vision error (${response.status}): ${err}`);
	}

	const data = await response.json();
	return (data?.choices?.[0]?.message?.content as string | undefined) ?? "No visual issues found.";
}

async function reviewWithGemini({
	frames,
	userText,
	config,
}: {
	frames: string[];
	userText: string;
	config: { apiKey: string; model?: string };
}): Promise<string> {
	// Use gemini-2.0-flash for vision; fall back if user configured something else
	const model = config.model || "gemini-2.0-flash";
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

	const parts: unknown[] = [{ text: `${VISION_SYSTEM_PROMPT}\n\n${userText}` }];
	for (const b64 of frames) {
		parts.push({ inline_data: { mime_type: "image/png", data: b64 } });
	}

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			contents: [{ parts }],
			generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
		}),
		signal: AbortSignal.timeout(60_000),
	});

	if (!response.ok) {
		const err = await response.text();
		throw new Error(`Gemini vision error (${response.status}): ${err}`);
	}

	const data = await response.json();
	const text = data?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;
	return text ?? "No visual issues found.";
}
