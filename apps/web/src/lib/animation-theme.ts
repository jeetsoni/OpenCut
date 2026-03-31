/**
 * Animation theme system — defines color palettes for AI-generated animations.
 *
 * Users select a preset or define a custom theme. The theme is stored in localStorage
 * and injected into every AI prompt at generation time so the Remotion components
 * reflect the chosen visual style.
 */

const ANIMATION_THEME_STORAGE_KEY = "opencut:animation-theme";

export interface AnimationTheme {
	id: string;
	name: string;
	background: string;
	surface: string;
	raised: string;
	textPrimary: string;
	textMuted: string;
	accents: {
		/** Red — errors, mistakes, failures, negatives */
		hookFear: string;
		/** Amber — warnings, analogies, real-world concepts */
		wrongPath: string;
		/** Sky blue — tech terms, code, system components */
		techCode: string;
		/** Green — solutions, success, positive outcomes */
		revelation: string;
		/** Yellow — CTA, power statements, revelations */
		cta: string;
		/** Violet — architecture, orchestration, system-level */
		violet: string;
	};
}

/**
 * Derive tinted card background colors from the theme's accent colors.
 * Each card tinted color is the accent blended at ~12% opacity over the background.
 */
export function getCardTinted(theme: AnimationTheme): {
	sky: string;
	red: string;
	green: string;
	amber: string;
	violet: string;
	yellow: string;
} {
	function blend(bg: string, accent: string, alpha: number): string {
		const p = (hex: string) => ({
			r: parseInt(hex.slice(1, 3), 16),
			g: parseInt(hex.slice(3, 5), 16),
			b: parseInt(hex.slice(5, 7), 16),
		});
		const b = p(bg);
		const a = p(accent);
		const mix = (x: number, y: number) => Math.round(x * (1 - alpha) + y * alpha);
		const h = (n: number) => n.toString(16).padStart(2, "0");
		return `#${h(mix(b.r, a.r))}${h(mix(b.g, a.g))}${h(mix(b.b, a.b))}`;
	}
	const bg = theme.background;
	return {
		sky: blend(bg, theme.accents.techCode, 0.12),
		red: blend(bg, theme.accents.hookFear, 0.12),
		green: blend(bg, theme.accents.revelation, 0.12),
		amber: blend(bg, theme.accents.wrongPath, 0.12),
		violet: blend(bg, theme.accents.violet, 0.12),
		yellow: blend(bg, theme.accents.cta, 0.08),
	};
}

export const ANIMATION_THEME_PRESETS: AnimationTheme[] = [
	{
		id: "studio",
		name: "Studio",
		background: "#0F1117",
		surface: "#161B25",
		raised: "#1E2535",
		textPrimary: "#EEF2FF",
		textMuted: "#6B7FA0",
		accents: {
			/** Muted coral — errors */
			hookFear: "#D96B6B",
			/** Warm amber — warnings */
			wrongPath: "#D4924A",
			/** Deep teal — primary accent */
			techCode: "#1DB9AE",
			/** Soft mint — success, positive */
			revelation: "#5ECFB0",
			/** Light mint tint — CTA, highlights */
			cta: "#A8E6D8",
			/** Muted periwinkle — architecture */
			violet: "#7B8FCC",
		},
	},
	{
		id: "studio-violet",
		name: "Studio Violet",
		background: "#100F17",
		surface: "#181625",
		raised: "#221E35",
		textPrimary: "#F2EEFF",
		textMuted: "#8B7FA0",
		accents: {
			hookFear: "#D96B8B",
			wrongPath: "#D4A04A",
			techCode: "#9B7FE8",
			revelation: "#B08FE8",
			cta: "#D4B8FF",
			violet: "#7B8FCC",
		},
	},
	{
		id: "studio-rose",
		name: "Studio Rose",
		background: "#141014",
		surface: "#1E1820",
		raised: "#2A2028",
		textPrimary: "#FFF0F4",
		textMuted: "#A08090",
		accents: {
			hookFear: "#E85A6B",
			wrongPath: "#E8A060",
			techCode: "#E87B9B",
			revelation: "#F0A0B8",
			cta: "#FFD0E0",
			violet: "#B080C0",
		},
	},
	{
		id: "studio-amber",
		name: "Studio Amber",
		background: "#131110",
		surface: "#1E1A18",
		raised: "#2A2420",
		textPrimary: "#FFF8F0",
		textMuted: "#A09080",
		accents: {
			hookFear: "#D96B5B",
			wrongPath: "#E8A050",
			techCode: "#E8B060",
			revelation: "#F0C878",
			cta: "#FFE0A0",
			violet: "#C0A080",
		},
	},
	{
		id: "studio-blue",
		name: "Studio Blue",
		background: "#0E1118",
		surface: "#141A28",
		raised: "#1A2438",
		textPrimary: "#F0F4FF",
		textMuted: "#7088B0",
		accents: {
			hookFear: "#D97070",
			wrongPath: "#D4A060",
			techCode: "#5090E8",
			revelation: "#70B0F0",
			cta: "#A0D0FF",
			violet: "#8090D0",
		},
	},
	{
		id: "studio-mono",
		name: "Studio Mono",
		background: "#101012",
		surface: "#18181C",
		raised: "#222228",
		textPrimary: "#F0F0F4",
		textMuted: "#808090",
		accents: {
			hookFear: "#C07070",
			wrongPath: "#B09070",
			techCode: "#90A0B0",
			revelation: "#A0B0A0",
			cta: "#D0D0D8",
			violet: "#9090A0",
		},
	},
	{
		id: "dark",
		name: "Dark",
		background: "#111318",
		surface: "#1C1F2E",
		raised: "#252840",
		textPrimary: "#F8F8F8",
		textMuted: "#9A9AA8",
		accents: {
			hookFear: "#F55B5B",
			wrongPath: "#F5A623",
			techCode: "#5BB8F5",
			revelation: "#3DD68C",
			cta: "#E8FF47",
			violet: "#7B6CF6",
		},
	},
	{
		id: "neon",
		name: "Neon",
		background: "#0A0A0F",
		surface: "#12121A",
		raised: "#1A1A28",
		textPrimary: "#F0F0FF",
		textMuted: "#7070A0",
		accents: {
			hookFear: "#FF2255",
			wrongPath: "#FF9900",
			techCode: "#00CCFF",
			revelation: "#00FF88",
			cta: "#FFFF00",
			violet: "#CC44FF",
		},
	},
	{
		id: "ocean",
		name: "Ocean",
		background: "#091525",
		surface: "#0F2040",
		raised: "#152850",
		textPrimary: "#E8F4FF",
		textMuted: "#5A84B4",
		accents: {
			hookFear: "#FF6B6B",
			wrongPath: "#FFB347",
			techCode: "#40C8E0",
			revelation: "#4DFFB4",
			cta: "#F0FF44",
			violet: "#8B7FFF",
		},
	},
	{
		id: "sunset",
		name: "Sunset",
		background: "#180E08",
		surface: "#281608",
		raised: "#381E10",
		textPrimary: "#FFF0E8",
		textMuted: "#B88060",
		accents: {
			hookFear: "#FF4444",
			wrongPath: "#FF8C00",
			techCode: "#FFD700",
			revelation: "#FF69B4",
			cta: "#FF6347",
			violet: "#DA70D6",
		},
	},
	{
		id: "forest",
		name: "Forest",
		background: "#08120A",
		surface: "#0E1A10",
		raised: "#142214",
		textPrimary: "#E8FFE8",
		textMuted: "#508050",
		accents: {
			hookFear: "#FF5555",
			wrongPath: "#FFA500",
			techCode: "#44CCAA",
			revelation: "#44FF88",
			cta: "#CCFF44",
			violet: "#9966FF",
		},
	},
];

export const DEFAULT_THEME = ANIMATION_THEME_PRESETS[0]; // Studio

export function getAnimationTheme(): AnimationTheme {
	try {
		const raw = localStorage.getItem(ANIMATION_THEME_STORAGE_KEY);
		if (!raw) return DEFAULT_THEME;
		return JSON.parse(raw) as AnimationTheme;
	} catch {
		return DEFAULT_THEME;
	}
}

export function setAnimationTheme(theme: AnimationTheme): void {
	localStorage.setItem(ANIMATION_THEME_STORAGE_KEY, JSON.stringify(theme));
}
