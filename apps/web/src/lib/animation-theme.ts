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
	{
		id: "daylight",
		name: "Daylight",
		background: "#FFFFFF",
		surface: "#F5F5F0",
		raised: "#EAEAE4",
		textPrimary: "#1A1A1A",
		textMuted: "#7A7A72",
		accents: {
			hookFear: "#E8453C",
			wrongPath: "#F5A623",
			techCode: "#2196F3",
			revelation: "#34A853",
			cta: "#FF9800",
			violet: "#7C4DFF",
		},
	},
	{
		id: "warm-paper",
		name: "Warm Paper",
		background: "#FDF8F0",
		surface: "#F5EDE0",
		raised: "#EBE2D4",
		textPrimary: "#2C2418",
		textMuted: "#8C7E6A",
		accents: {
			hookFear: "#D94F3D",
			wrongPath: "#E8943A",
			techCode: "#C87830",
			revelation: "#6B9E4F",
			cta: "#E8A020",
			violet: "#9B7B5E",
		},
	},
	{
		id: "citrus",
		name: "Citrus",
		background: "#FFFEF8",
		surface: "#FFF8E8",
		raised: "#FFF0D0",
		textPrimary: "#1C1800",
		textMuted: "#8A8060",
		accents: {
			hookFear: "#E85A30",
			wrongPath: "#F5A623",
			techCode: "#00ACC1",
			revelation: "#4CAF50",
			cta: "#FF8F00",
			violet: "#AB47BC",
		},
	},
	{
		id: "clean-slate",
		name: "Clean Slate",
		background: "#F8FAFB",
		surface: "#EFF3F5",
		raised: "#E4EAED",
		textPrimary: "#0F1B24",
		textMuted: "#6B8090",
		accents: {
			hookFear: "#EF4444",
			wrongPath: "#F59E0B",
			techCode: "#0EA5E9",
			revelation: "#10B981",
			cta: "#F97316",
			violet: "#8B5CF6",
		},
	},
	{
		id: "peach",
		name: "Peach",
		background: "#FFF9F5",
		surface: "#FFEFE5",
		raised: "#FFE4D5",
		textPrimary: "#2A1810",
		textMuted: "#A08070",
		accents: {
			hookFear: "#E05050",
			wrongPath: "#E89050",
			techCode: "#E07848",
			revelation: "#60A880",
			cta: "#F08040",
			violet: "#C08090",
		},
	},
	{
		id: "mint",
		name: "Mint",
		background: "#F5FDFB",
		surface: "#E8F8F4",
		raised: "#D8F0EA",
		textPrimary: "#0A2018",
		textMuted: "#608878",
		accents: {
			hookFear: "#E06060",
			wrongPath: "#E0A040",
			techCode: "#20A898",
			revelation: "#30C090",
			cta: "#40B880",
			violet: "#7090C0",
		},
	},
	{
		id: "lavender",
		name: "Lavender",
		background: "#FAF8FF",
		surface: "#F0ECFA",
		raised: "#E4DEF2",
		textPrimary: "#1A1428",
		textMuted: "#7868A0",
		accents: {
			hookFear: "#D84E68",
			wrongPath: "#D4904A",
			techCode: "#7C5CE0",
			revelation: "#6DA0E0",
			cta: "#A06CE0",
			violet: "#9060D0",
		},
	},
	{
		id: "sky",
		name: "Sky",
		background: "#F6FBFF",
		surface: "#E8F2FC",
		raised: "#D8E8F8",
		textPrimary: "#0C1824",
		textMuted: "#5880A0",
		accents: {
			hookFear: "#E05454",
			wrongPath: "#E89840",
			techCode: "#2088D0",
			revelation: "#28A8A0",
			cta: "#3898E0",
			violet: "#6878C8",
		},
	},
	{
		id: "rose-garden",
		name: "Rose Garden",
		background: "#FFF7F9",
		surface: "#FCEEF2",
		raised: "#F8E0E8",
		textPrimary: "#28101A",
		textMuted: "#A07080",
		accents: {
			hookFear: "#D84060",
			wrongPath: "#E09050",
			techCode: "#D06888",
			revelation: "#C080A0",
			cta: "#E06888",
			violet: "#A868B8",
		},
	},
	{
		id: "sand",
		name: "Sand",
		background: "#FDFBF6",
		surface: "#F5F0E4",
		raised: "#ECE6D6",
		textPrimary: "#201C10",
		textMuted: "#908060",
		accents: {
			hookFear: "#C85040",
			wrongPath: "#C89040",
			techCode: "#A08848",
			revelation: "#80A050",
			cta: "#C8A030",
			violet: "#A09068",
		},
	},
	{
		id: "lemon",
		name: "Lemon",
		background: "#FFFEF5",
		surface: "#FDF8E0",
		raised: "#F8F0C8",
		textPrimary: "#1C1A04",
		textMuted: "#888050",
		accents: {
			hookFear: "#D85040",
			wrongPath: "#E8A020",
			techCode: "#B89820",
			revelation: "#70A840",
			cta: "#D8B010",
			violet: "#A098D0",
		},
	},
	{
		id: "arctic",
		name: "Arctic",
		background: "#F8FCFD",
		surface: "#ECF5F8",
		raised: "#DEF0F4",
		textPrimary: "#0A1820",
		textMuted: "#5888A0",
		accents: {
			hookFear: "#D06060",
			wrongPath: "#D0A050",
			techCode: "#2098B8",
			revelation: "#30B0A0",
			cta: "#28A0C0",
			violet: "#6080B8",
		},
	},
	{
		id: "coral",
		name: "Coral",
		background: "#FFFAF8",
		surface: "#FFF0EA",
		raised: "#FFE4D8",
		textPrimary: "#281410",
		textMuted: "#A07868",
		accents: {
			hookFear: "#E04840",
			wrongPath: "#E88840",
			techCode: "#E07050",
			revelation: "#50A880",
			cta: "#F07848",
			violet: "#C07898",
		},
	},
	// ── Instagram-friendly themes ──────────────────────────────────────
	// Medium-dark backgrounds so Instagram's white UI icons (like, comment,
	// share, save) remain clearly visible while still feeling fresh & vibrant.
	{
		id: "ig-cream",
		name: "IG Cream",
		background: "#2C2820",
		surface: "#3A3428",
		raised: "#484030",
		textPrimary: "#FFF5E6",
		textMuted: "#C0A880",
		accents: {
			hookFear: "#E85A4A",
			wrongPath: "#F0A840",
			techCode: "#E8C060",
			revelation: "#80C878",
			cta: "#FFD070",
			violet: "#C0A0D0",
		},
	},
	{
		id: "ig-blush",
		name: "IG Blush",
		background: "#2A2024",
		surface: "#382830",
		raised: "#48303C",
		textPrimary: "#FFF0F4",
		textMuted: "#C89098",
		accents: {
			hookFear: "#F06070",
			wrongPath: "#F0A050",
			techCode: "#F08098",
			revelation: "#70C8A0",
			cta: "#FFB0C0",
			violet: "#B888D0",
		},
	},
	{
		id: "ig-sky",
		name: "IG Sky",
		background: "#1C2430",
		surface: "#243040",
		raised: "#2C3C50",
		textPrimary: "#F0F6FF",
		textMuted: "#88A8C8",
		accents: {
			hookFear: "#F06868",
			wrongPath: "#F0A848",
			techCode: "#60B0F0",
			revelation: "#50D0A0",
			cta: "#88D0FF",
			violet: "#9088E0",
		},
	},
	{
		id: "ig-mint",
		name: "IG Mint",
		background: "#1A2824",
		surface: "#203430",
		raised: "#28403A",
		textPrimary: "#F0FFF8",
		textMuted: "#80B8A0",
		accents: {
			hookFear: "#E86060",
			wrongPath: "#E8A848",
			techCode: "#40C8B0",
			revelation: "#58E8A0",
			cta: "#80F0C0",
			violet: "#8898D0",
		},
	},
	{
		id: "ig-lavender",
		name: "IG Lavender",
		background: "#222030",
		surface: "#2C2840",
		raised: "#383450",
		textPrimary: "#F4F0FF",
		textMuted: "#A098C0",
		accents: {
			hookFear: "#E86878",
			wrongPath: "#E0A050",
			techCode: "#9080F0",
			revelation: "#70B8E8",
			cta: "#C0A8FF",
			violet: "#A878E0",
		},
	},
	{
		id: "ig-sunset",
		name: "IG Sunset",
		background: "#2C1C18",
		surface: "#3C2820",
		raised: "#4C3028",
		textPrimary: "#FFF4E8",
		textMuted: "#C09070",
		accents: {
			hookFear: "#F04840",
			wrongPath: "#F09030",
			techCode: "#FFB848",
			revelation: "#F07050",
			cta: "#FF8840",
			violet: "#D888B0",
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
