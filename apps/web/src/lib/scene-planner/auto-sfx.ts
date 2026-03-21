/**
 * Auto-SFX: parses SFX hints from AI-generated animation beats,
 * searches Freesound, and inserts matching audio clips into the timeline.
 */

import type { EditorCore } from "@/core";
import type { PlannedScene } from "./schema";
import { buildLibraryAudioElement } from "@/lib/timeline/element-utils";
import type { SoundEffect } from "@/types/sounds";

export interface SfxHint {
	query: string;
	/** Absolute video timestamp in seconds */
	absoluteTime: number;
	/** Original hint string for debugging */
	raw: string;
	/** Path to local SFX file if matched, null if needs Freesound search */
	localPath: string | null;
}

export interface SfxResult {
	hint: SfxHint;
	success: boolean;
	soundName?: string;
	error?: string;
}

/**
 * Known local SFX files in /public/sfx-sound/.
 * These are used as the primary source before falling back to Freesound search.
 */
const LOCAL_SFX_FILES: Record<string, string> = {
	"tech_blip.wav": "/sfx-sound/tech_blip.wav",
	"tech_blip": "/sfx-sound/tech_blip.wav",
	"notification_ping.wav": "/sfx-sound/notification_ping.wav",
	"notification_ping": "/sfx-sound/notification_ping.wav",
	"error_buzz.wav": "/sfx-sound/error_buzz.wav",
	"error_buzz": "/sfx-sound/error_buzz.wav",
	"success_chime.wav": "/sfx-sound/success_chime.wav",
	"success_chime": "/sfx-sound/success_chime.wav",
	"keyboard.mp3": "/sfx-sound/keyboard.mp3",
	"keyboard": "/sfx-sound/keyboard.mp3",
};

/**
 * Parses a single SFX hint string from a beat.
 * Expected format: "filename at 2.3s volume:0.8 playbackRate:1.2 (reason)"
 * The timestamp is relative to the beat's start time.
 */
function parseSfxHint(hintStr: string, beatStartTime: number): SfxHint | null {
	const match = hintStr.match(/^(\S+)\s+at\s+([\d.]+)s/i);
	if (!match) return null;

	const rawName = match[1].trim();
	const localTime = parseFloat(match[2]);
	if (Number.isNaN(localTime)) return null;

	// Check if this is a known local file first
	const localPath = LOCAL_SFX_FILES[rawName] || LOCAL_SFX_FILES[rawName.replace(/\.\w+$/, "")];

	// Convert filename to search query: "impact_hit.wav" → "impact hit"
	const query = rawName
		.replace(/\.\w+$/, "") // remove extension
		.replace(/[_-]/g, " ") // underscores/dashes → spaces
		.trim();

	if (!query) return null;

	return {
		query,
		absoluteTime: beatStartTime + localTime,
		raw: hintStr,
		localPath: localPath || null,
	};
}

/**
 * Searches for a sound effect matching the query via the internal API.
 * Returns the best match with a previewUrl, or null if none found.
 */
async function searchSound(query: string): Promise<SoundEffect | null> {
	const params = new URLSearchParams({
		q: query,
		type: "effects",
		sort: "score",
		page_size: "5",
		min_rating: "3",
	});

	const response = await fetch(`/api/sounds/search?${params.toString()}`);
	if (!response.ok) return null;

	const data = (await response.json()) as { results: SoundEffect[] };
	return data.results.find((s) => s.previewUrl) ?? null;
}

/**
 * Fetches a sound's preview audio and decodes it into an AudioBuffer.
 */
async function fetchAndDecode(
	previewUrl: string,
): Promise<{ buffer: AudioBuffer; ctx: AudioContext } | null> {
	const response = await fetch(previewUrl);
	if (!response.ok) return null;

	const arrayBuffer = await response.arrayBuffer();
	const ctx = new AudioContext();
	try {
		const buffer = await ctx.decodeAudioData(arrayBuffer);
		return { buffer, ctx };
	} catch {
		await ctx.close();
		return null;
	}
}

/**
 * Collects all SFX hints from a PlannedScene's animation beats.
 */
export function collectSfxHints(direction: PlannedScene): SfxHint[] {
	const hints: SfxHint[] = [];
	for (const beat of direction.animationDirection.beats) {
		for (const sfxStr of beat.sfx) {
			const hint = parseSfxHint(sfxStr, beat.timeRange[0]);
			if (hint) hints.push(hint);
		}
	}
	return hints;
}

/**
 * Applies auto-SFX for a scene: searches for each SFX hint and inserts
 * matching audio clips at the correct absolute timestamps in the timeline.
 *
 * @returns Array of results (one per hint), indicating success or failure.
 */
export async function applyAutoSfx({
	direction,
	editor,
}: {
	direction: PlannedScene;
	editor: EditorCore;
}): Promise<SfxResult[]> {
	const hints = collectSfxHints(direction);
	if (hints.length === 0) return [];

	// Find or create an audio track once — reused for all clips
	const getAudioTrackId = (): string => {
		const existing = editor.timeline.getTracks().find((t) => t.type === "audio");
		return existing ? existing.id : editor.timeline.addTrack({ type: "audio" });
	};

	// Process all hints in parallel for speed
	const results = await Promise.all(
		hints.map(async (hint): Promise<SfxResult> => {
			try {
				// Try local SFX file first
				if (hint.localPath) {
					const decoded = await fetchAndDecode(hint.localPath);
					if (decoded) {
						const { buffer, ctx } = decoded;
						void ctx.close();

						const trackId = getAudioTrackId();
						const fileName = hint.localPath.split("/").pop() || hint.query;
						const element = buildLibraryAudioElement({
							sourceUrl: hint.localPath,
							name: `SFX: ${fileName}`,
							duration: buffer.duration,
							startTime: hint.absoluteTime,
							buffer,
						});

						editor.timeline.insertElement({
							placement: { mode: "explicit", trackId },
							element,
						});

						return { hint, success: true, soundName: fileName };
					}
				}

				// Fall back to Freesound search
				const sound = await searchSound(hint.query);
				if (!sound?.previewUrl) {
					return { hint, success: false, error: `No sound found for "${hint.query}"` };
				}

				const decoded = await fetchAndDecode(sound.previewUrl);
				if (!decoded) {
					return { hint, success: false, error: `Failed to decode audio for "${hint.query}"` };
				}

				const { buffer, ctx } = decoded;
				void ctx.close();

				const trackId = getAudioTrackId();
				const element = buildLibraryAudioElement({
					sourceUrl: sound.previewUrl,
					name: sound.name,
					duration: sound.duration,
					startTime: hint.absoluteTime,
					buffer,
				});

				editor.timeline.insertElement({
					placement: { mode: "explicit", trackId },
					element,
				});

				return { hint, success: true, soundName: sound.name };
			} catch (err) {
				return {
					hint,
					success: false,
					error: err instanceof Error ? err.message : "Unknown error",
				};
			}
		}),
	);

	return results;
}
