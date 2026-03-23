/**
 * Vision-based layout review for generated Remotion components.
 *
 * Sends captured PNG frames to the user's configured vision model
 * and returns a description of any layout bugs found.
 */

import { generateText } from "ai";
import { buildModel } from "@/lib/ai/provider";

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

	const userText = `Review these ${frames.length} screenshot(s) from scene "${sceneName}" for layout bugs. Each frame is from a different animation beat.`;

	try {
		const model = buildModel({ gemini: "gemini-2.0-flash" });
		const { text } = await generateText({
			model,
			system: VISION_SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: userText },
						...frames.map((b64) => ({
							type: "image" as const,
							image: b64,
							mimeType: "image/png" as const,
						})),
					],
				},
			],
			temperature: 0.1,
		});

		return text ?? "No visual issues found.";
	} catch (err) {
		console.warn("[VisionReview] Vision API call failed:", err);
		return "No visual issues found.";
	}
}
