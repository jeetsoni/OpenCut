import type { ShortcutKey } from "@/types/keybinding";

export type TActionCategory =
	| "playback"
	| "navigation"
	| "editing"
	| "selection"
	| "history"
	| "timeline"
	| "controls";

export interface TActionDefinition {
	description: string;
	category: TActionCategory;
	defaultShortcuts?: ShortcutKey[];
	args?: Record<string, unknown>;
}

export const ACTIONS = {
	"toggle-play": {
		description: "Play/Pause",
		category: "playback",
		defaultShortcuts: ["space", "k"],
	},
	"stop-playback": {
		description: "Stop playback",
		category: "playback",
	},
	"seek-forward": {
		description: "Seek forward 1 second",
		category: "playback",
		defaultShortcuts: ["l"],
		args: { seconds: "number" },
	},
	"seek-backward": {
		description: "Seek backward 1 second",
		category: "playback",
		defaultShortcuts: ["j"],
		args: { seconds: "number" },
	},
	"frame-step-forward": {
		description: "Frame step forward",
		category: "navigation",
		defaultShortcuts: ["right"],
	},
	"frame-step-backward": {
		description: "Frame step backward",
		category: "navigation",
		defaultShortcuts: ["left"],
	},
	"jump-forward": {
		description: "Jump forward 5 seconds",
		category: "navigation",
		defaultShortcuts: ["shift+right"],
		args: { seconds: "number" },
	},
	"jump-backward": {
		description: "Jump backward 5 seconds",
		category: "navigation",
		defaultShortcuts: ["shift+left"],
		args: { seconds: "number" },
	},
	"goto-start": {
		description: "Go to timeline start",
		category: "navigation",
		defaultShortcuts: ["home", "enter"],
	},
	"goto-end": {
		description: "Go to timeline end",
		category: "navigation",
		defaultShortcuts: ["end"],
	},
	split: {
		description: "Split elements at playhead",
		category: "editing",
		defaultShortcuts: ["s"],
	},
	"split-left": {
		description: "Split and remove left",
		category: "editing",
		defaultShortcuts: ["q"],
	},
	"split-right": {
		description: "Split and remove right",
		category: "editing",
		defaultShortcuts: ["w"],
	},
	"delete-selected": {
		description: "Delete selected elements",
		category: "editing",
		defaultShortcuts: ["backspace", "delete"],
	},
	"copy-selected": {
		description: "Copy selected elements",
		category: "editing",
		defaultShortcuts: ["ctrl+c"],
	},
	"paste-copied": {
		description: "Paste elements at playhead",
		category: "editing",
		defaultShortcuts: ["ctrl+v"],
	},
	"toggle-snapping": {
		description: "Toggle snapping",
		category: "editing",
		defaultShortcuts: ["n"],
	},
	"toggle-ripple-editing": {
		description: "Toggle ripple editing",
		category: "editing",
	},
	"select-all": {
		description: "Select all elements",
		category: "selection",
		defaultShortcuts: ["ctrl+a"],
	},
	"deselect-all": {
		description: "Deselect all elements",
		category: "selection",
		defaultShortcuts: ["escape"],
	},
	"duplicate-selected": {
		description: "Duplicate selected element",
		category: "selection",
		defaultShortcuts: ["ctrl+d"],
	},
	"toggle-elements-muted-selected": {
		description: "Mute/unmute selected elements",
		category: "selection",
	},
	"toggle-elements-visibility-selected": {
		description: "Show/hide selected elements",
		category: "selection",
	},
	"toggle-bookmark": {
		description: "Toggle bookmark at playhead",
		category: "timeline",
	},
	undo: {
		description: "Undo",
		category: "history",
		defaultShortcuts: ["ctrl+z"],
	},
	redo: {
		description: "Redo",
		category: "history",
		defaultShortcuts: ["ctrl+shift+z", "ctrl+y"],
	},
	"remove-silence": {
		description: "Remove silent portions from selected elements",
		category: "editing",
	},
	"remove-retakes": {
		description: "AI-detect and remove retakes from selected elements",
		category: "editing",
	},
	"review-removed-retakes": {
		description: "Review and restore clips removed by retake detection",
		category: "editing",
	},
	"close-gaps": {
		description: "Close gaps between elements on all tracks",
		category: "editing",
	},
	"generate-transcript": {
		description: "Generate word-level transcript for the current timeline",
		category: "editing",
	},
	"generate-scene-plan": {
		description: "AI-generate scene plan with animation directions from transcript",
		category: "editing",
	},
	"detect-scene-boundaries": {
		description: "AI-detect scene boundaries from transcript",
		category: "editing",
	},
	"generate-scene-direction": {
		description: "AI-generate design direction for a specific scene",
		category: "editing",
	},
	"generate-scene-animation": {
		description: "AI-generate Remotion animation code for a specific scene",
		category: "editing",
	},
	"tweak-scene-animation": {
		description: "AI-tweak existing animation code for a scene based on user instructions",
		category: "editing",
	},
	"generate-animations": {
		description: "AI-generate Remotion animation code from scene plan",
		category: "editing",
	},
	"bake-animation": {
		description: "Render animations to MP4 on the server for fast export",
		category: "editing",
	},
	"generate-all-animations": {
		description: "Detect scene boundaries then generate direction + animation code for every scene",
		category: "editing",
	},
	"regenerate-all-animations": {
		description: "Clear all existing scene data and regenerate everything from scratch",
		category: "editing",
	},
	"generate-remaining-animations": {
		description: "Generate direction + code only for scenes that don't have them yet",
		category: "editing",
	},
	"retranscribe-selection": {
		description: "Re-transcribe selected clips to fix incomplete or inaccurate words",
		category: "editing",
	},
} as const satisfies Record<string, TActionDefinition>;

export type TAction = keyof typeof ACTIONS;

export function getActionDefinition({ action }: { action: TAction }): TActionDefinition {
	return ACTIONS[action];
}

export function getDefaultShortcuts(): Record<ShortcutKey, TAction> {
	const shortcuts: Record<string, TAction> = {};

	for (const [action, def] of Object.entries(ACTIONS) as Array<
		[TAction, TActionDefinition]
	>) {
		if (def.defaultShortcuts) {
			for (const shortcut of def.defaultShortcuts) {
				shortcuts[shortcut] = action;
			}
		}
	}

	return shortcuts as Record<ShortcutKey, TAction>;
}
