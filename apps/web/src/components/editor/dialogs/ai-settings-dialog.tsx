import { useState, useEffect } from "react";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	getAIProviderConfig,
	setAIProviderConfig,
	type AIProviderType,
	type AIModelOverrides,
} from "@/lib/ai-provider";
import {
	getAnimationTheme,
	setAnimationTheme,
	ANIMATION_THEME_PRESETS,
	DEFAULT_THEME,
	type AnimationTheme,
} from "@/lib/animation-theme";
import { cn } from "@/utils/ui";

const BASE_COLOR_KEYS: { key: keyof Omit<AnimationTheme, "id" | "name" | "accents">; label: string }[] = [
	{ key: "background", label: "Background" },
	{ key: "surface", label: "Surface" },
	{ key: "raised", label: "Raised" },
	{ key: "textPrimary", label: "Text Primary" },
	{ key: "textMuted", label: "Text Muted" },
];

const ACCENT_KEYS: { key: keyof AnimationTheme["accents"]; label: string }[] = [
	{ key: "hookFear", label: "Error / Fear" },
	{ key: "wrongPath", label: "Warning" },
	{ key: "techCode", label: "Tech / Code" },
	{ key: "revelation", label: "Success" },
	{ key: "cta", label: "Highlight / CTA" },
	{ key: "violet", label: "System / Arch" },
];

const FEATURE_LABELS: { key: keyof AIModelOverrides; label: string; hint: string; defaultGemini: string }[] = [
	{ key: "boundaryDetect", label: "Boundary Detection", hint: "Splits transcript into scenes. Flash is sufficient.", defaultGemini: "gemini-2.5-flash" },
	{ key: "sceneDirection", label: "Scene Direction", hint: "Generates animation beats and layout per scene. Flash is sufficient.", defaultGemini: "gemini-2.5-flash" },
	{ key: "codeGen", label: "Code Generation", hint: "Writes the Remotion component. Pro gives better results.", defaultGemini: "gemini-2.5-pro-preview-06-05" },
	{ key: "codeReview", label: "Layout Review", hint: "Agentic pass that fixes overflow/overlap bugs in generated code. Flash is fine.", defaultGemini: "gemini-2.5-flash" },
	{ key: "tweak", label: "Tweak", hint: "Surgical edits to existing animations. Pro recommended.", defaultGemini: "gemini-2.5-pro-preview-06-05" },
	{ key: "visionReview", label: "Vision Review", hint: "Inspects rendered screenshots for layout bugs. Must be a vision-capable model. Flash is fast and sufficient.", defaultGemini: "gemini-2.0-flash" },
];

export function AISettingsDialog({
	isOpen,
	onOpenChange,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [provider, setProvider] = useState<AIProviderType>("gemini");
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [groqApiKey, setGroqApiKey] = useState("");
	const [transcriptionLanguage, setTranscriptionLanguage] = useState("");
	const [modelOverrides, setModelOverrides] = useState<AIModelOverrides>({});
	const [skipLayoutReview, setSkipLayoutReview] = useState(false);
	const [skipVisionReview, setSkipVisionReview] = useState(true);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [selectedTheme, setSelectedTheme] = useState<AnimationTheme>(DEFAULT_THEME);

	useEffect(() => {
		if (isOpen) {
			const config = getAIProviderConfig();
			if (config) {
				setProvider(config.provider);
				setApiKey(config.apiKey);
				setModel(config.model ?? "");
				setBaseUrl(config.baseUrl ?? "");
				setGroqApiKey(config.groqApiKey ?? "");
				setTranscriptionLanguage(config.transcriptionLanguage ?? "");
				setModelOverrides(config.modelOverrides ?? {});
				setSkipLayoutReview(config.skipLayoutReview ?? false);
				setSkipVisionReview(config.skipVisionReview ?? true);
			}
			setSelectedTheme(getAnimationTheme());
		}
	}, [isOpen]);

	const handleSave = () => {
		setAIProviderConfig({
			provider,
			apiKey,
			model: model || undefined,
			baseUrl: baseUrl || undefined,
			groqApiKey: groqApiKey || undefined,
			transcriptionLanguage: transcriptionLanguage || undefined,
			modelOverrides: Object.keys(modelOverrides).length > 0 ? modelOverrides : undefined,
			skipLayoutReview: skipLayoutReview || undefined,
			skipVisionReview: skipVisionReview || undefined,
		});
		setAnimationTheme(selectedTheme);
		onOpenChange(false);
	};

	const setOverride = (key: keyof AIModelOverrides, value: string) => {
		setModelOverrides((prev) => {
			const next = { ...prev };
			if (value) {
				next[key] = value;
			} else {
				delete next[key];
			}
			return next;
		});
	};

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent onOpenAutoFocus={(event) => event.preventDefault()}>
				<DialogHeader>
					<DialogTitle>AI Settings</DialogTitle>
				</DialogHeader>
				<DialogBody className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
					<p className="text-muted-foreground text-sm">
						Your keys are stored locally in your browser only.
					</p>

					<div className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
						LLM Provider (for retake analysis)
					</div>

					<div className="flex flex-col gap-1.5">
						<Label>Provider</Label>
						<Select
							value={provider}
							onValueChange={(v) => setProvider(v as AIProviderType)}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="gemini">Google Gemini</SelectItem>
								<SelectItem value="openai">OpenAI / Compatible</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label>API Key</Label>
						<Input
							type="password"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder={provider === "gemini" ? "AIza..." : "sk-..."}
							size="sm"
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label>
							Model{" "}
							<span className="text-muted-foreground font-normal">
								(optional)
							</span>
						</Label>
						<Input
							value={model}
							onChange={(e) => setModel(e.target.value)}
							placeholder={
								provider === "gemini" ? "gemini-2.0-flash" : "gpt-4o-mini"
							}
							size="sm"
						/>
					</div>

					{provider === "openai" && (
						<div className="flex flex-col gap-1.5">
							<Label>
								Base URL{" "}
								<span className="text-muted-foreground font-normal">
									(optional)
								</span>
							</Label>
							<Input
								value={baseUrl}
								onChange={(e) => setBaseUrl(e.target.value)}
								placeholder="https://api.openai.com/v1"
								size="sm"
							/>
						</div>
					)}

					<div className="bg-border my-1 h-px" />

				{/* Advanced: per-feature model overrides */}
				<button
					type="button"
					onClick={() => setShowAdvanced((v) => !v)}
					className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
				>
					<span>{showAdvanced ? "▾" : "▸"}</span>
					<span className="font-medium uppercase tracking-wider">Per-feature Model Overrides</span>
				</button>

				{showAdvanced && (
					<div className="flex flex-col gap-3 pl-3 border-l border-border">
						<p className="text-muted-foreground text-xs">
							Override which model is used for each pipeline step. Leave blank to use the global model above.
						</p>

						{FEATURE_LABELS.map(({ key, label, hint, defaultGemini }) => (
							<div key={key} className="flex flex-col gap-1">
								<Label className="text-xs">{label}</Label>
								<Input
									value={modelOverrides[key] ?? ""}
									onChange={(e) => setOverride(key, e.target.value)}
									placeholder={`default: ${defaultGemini}`}
									size="sm"
								/>
								<p className="text-muted-foreground text-xs">{hint}</p>
							</div>
						))}

						<div className="flex items-start gap-2 pt-1">
							<input
								id="skip-review"
								type="checkbox"
								checked={skipLayoutReview}
								onChange={(e) => setSkipLayoutReview(e.target.checked)}
								className="mt-0.5 accent-primary"
							/>
							<div>
								<label htmlFor="skip-review" className="text-xs font-medium cursor-pointer">
									Skip layout review pass
								</label>
								<p className="text-muted-foreground text-xs mt-0.5">
									Removes the agentic review step after code generation. Faster, but may produce occasional overflow or positioning bugs.
								</p>
							</div>
						</div>

						<div className="flex items-start gap-2 pt-1">
							<input
								id="skip-vision-review"
								type="checkbox"
								checked={skipVisionReview}
								onChange={(e) => setSkipVisionReview(e.target.checked)}
								className="mt-0.5 accent-primary"
							/>
							<div>
								<label htmlFor="skip-vision-review" className="text-xs font-medium cursor-pointer">
									Skip vision review pass
								</label>
								<p className="text-muted-foreground text-xs mt-0.5">
									Disables screenshot-based layout QA. Enable only if your model supports vision/images.
								</p>
							</div>
						</div>
					</div>
				)}

				<div className="bg-border my-1 h-px" />

				<div className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
					Animation Theme
				</div>

				<div className="grid grid-cols-2 gap-3">
					{ANIMATION_THEME_PRESETS.map((preset) => {
						const isSelected = selectedTheme.id === preset.id;
						const accents = Object.values(preset.accents) as string[];
						return (
							<button
								key={preset.id}
								type="button"
								onClick={() => setSelectedTheme(preset)}
								className={cn(
									"group relative flex flex-col rounded-xl border-2 p-0 overflow-hidden transition-all",
									isSelected
										? "border-primary ring-1 ring-primary/30"
										: "border-border hover:border-foreground/25",
								)}
							>
								{/* Theme preview area */}
								<div
									style={{ backgroundColor: preset.background }}
									className="w-full p-3 flex flex-col gap-2"
								>
									{/* Simulated card with surface color */}
									<div
										style={{ backgroundColor: preset.surface }}
										className="rounded-md p-2 flex flex-col gap-1.5"
									>
										{/* Title text line */}
										<div
											style={{ backgroundColor: preset.textPrimary }}
											className="h-1.5 w-3/4 rounded-full opacity-90"
										/>
										{/* Muted text line */}
										<div
											style={{ backgroundColor: preset.textMuted }}
											className="h-1 w-1/2 rounded-full opacity-70"
										/>
									</div>
									{/* Accent color bar */}
									<div className="flex gap-1 px-0.5">
										{accents.map((color, i) => (
											<div
												key={i}
												style={{ backgroundColor: color }}
												className="h-2 flex-1 rounded-full first:rounded-l-full last:rounded-r-full"
											/>
										))}
									</div>
								</div>
								{/* Label */}
								<div className="flex items-center justify-between px-3 py-2 bg-card">
									<span className="text-xs font-medium">{preset.name}</span>
									{isSelected && (
										<div className="size-4 rounded-full bg-primary flex items-center justify-center">
											<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
												<path d="M2 5.5L4 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
											</svg>
										</div>
									)}
								</div>
							</button>
						);
					})}
					{/* Custom theme card */}
					<button
						type="button"
						onClick={() => {
							if (selectedTheme.id !== "custom") {
								setSelectedTheme({ ...selectedTheme, id: "custom", name: "Custom" });
							}
						}}
						className={cn(
							"group relative flex flex-col rounded-xl border-2 overflow-hidden transition-all",
							selectedTheme.id === "custom"
								? "border-primary ring-1 ring-primary/30"
								: "border-dashed border-border hover:border-foreground/25",
						)}
					>
						<div className="w-full p-3 flex items-center justify-center h-[72px]">
							<div className="flex flex-col items-center gap-1 text-muted-foreground">
								<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
									<path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
								</svg>
								<span className="text-[10px]">Create your own</span>
							</div>
						</div>
						<div className="flex items-center justify-between px-3 py-2 bg-card">
							<span className="text-xs font-medium">Custom</span>
							{selectedTheme.id === "custom" && (
								<div className="size-4 rounded-full bg-primary flex items-center justify-center">
									<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
										<path d="M2 5.5L4 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
									</svg>
								</div>
							)}
						</div>
					</button>
				</div>

				{selectedTheme.id === "custom" && (
					<div className="flex flex-col gap-2 pl-3 border-l border-border">
						<p className="text-muted-foreground text-xs">Base colors</p>
						{BASE_COLOR_KEYS.map(({ key, label }) => (
							<div key={key} className="flex items-center gap-2">
								<input
									type="color"
									value={selectedTheme[key]}
									onChange={(e) =>
										setSelectedTheme((prev) => ({ ...prev, [key]: e.target.value }))
									}
									className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
								/>
								<span className="text-xs text-muted-foreground flex-1">{label}</span>
								<span className="text-xs font-mono text-muted-foreground">{selectedTheme[key]}</span>
							</div>
						))}
						<p className="text-muted-foreground text-xs mt-1">Accents</p>
						{ACCENT_KEYS.map(({ key, label }) => (
							<div key={key} className="flex items-center gap-2">
								<input
									type="color"
									value={selectedTheme.accents[key]}
									onChange={(e) =>
										setSelectedTheme((prev) => ({
											...prev,
											accents: { ...prev.accents, [key]: e.target.value },
										}))
									}
									className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
								/>
								<span className="text-xs text-muted-foreground flex-1">{label}</span>
								<span className="text-xs font-mono text-muted-foreground">{selectedTheme.accents[key]}</span>
							</div>
						))}
					</div>
				)}

				<div className="bg-border my-1 h-px" />

					<div className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
						Transcription (Groq Whisper)
					</div>

					<div className="flex flex-col gap-1.5">
						<Label>Groq API Key</Label>
						<Input
							type="password"
							value={groqApiKey}
							onChange={(e) => setGroqApiKey(e.target.value)}
							placeholder="gsk_..."
							size="sm"
						/>
						<p className="text-muted-foreground text-xs">
							Free at console.groq.com — uses whisper-large-v3 for fast,
							accurate transcription. Without this, falls back to slower
							in-browser Whisper.
						</p>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label>
							Language{" "}
							<span className="text-muted-foreground font-normal">
								(optional)
							</span>
						</Label>
						<Input
							value={transcriptionLanguage}
							onChange={(e) => setTranscriptionLanguage(e.target.value)}
							placeholder='e.g. "hi" for Hindi, "en" for English'
							size="sm"
						/>
						<p className="text-muted-foreground text-xs">
							ISO 639-1 code. Leave empty for auto-detection.
						</p>
					</div>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={!apiKey.trim()}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
