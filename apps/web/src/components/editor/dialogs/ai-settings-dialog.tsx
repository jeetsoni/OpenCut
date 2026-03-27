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

const FEATURE_LABELS: { key: keyof AIModelOverrides; label: string; hint: string; defaultGemini: string }[] = [
	{ key: "boundaryDetect", label: "Boundary Detection", hint: "Splits transcript into scenes. Flash is sufficient.", defaultGemini: "gemini-2.5-flash" },
	{ key: "sceneDirection", label: "Scene Direction", hint: "Generates animation beats and layout per scene. Flash is sufficient.", defaultGemini: "gemini-2.5-flash" },
	{ key: "codeGen", label: "Code Generation", hint: "Writes the Remotion component. Pro gives better results.", defaultGemini: "gemini-2.5-pro-preview-06-05" },
	{ key: "codeReview", label: "Layout Review", hint: "Agentic pass that fixes overflow/overlap bugs in generated code. Flash is fine.", defaultGemini: "gemini-2.5-flash" },
	{ key: "tweak", label: "Tweak", hint: "Surgical edits to existing animations. Pro recommended.", defaultGemini: "gemini-2.5-pro-preview-06-05" },
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
	const [showAdvanced, setShowAdvanced] = useState(false);

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
			}
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
		});
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
