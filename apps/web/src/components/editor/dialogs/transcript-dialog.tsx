import { useState, useEffect, useCallback, useRef } from "react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogBody,
	DialogFooter,
	DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditor } from "@/hooks/use-editor";
import {
	getProjectTranscript,
	setProjectTranscript,
	deleteProjectTranscript,
} from "@/lib/transcription/transcript-store";
import type { ProjectTranscript, TranscriptionWord } from "@/types/transcription";
import { invokeAction } from "@/lib/actions";
import { toast } from "sonner";

export function TranscriptDialog({
	isOpen,
	onOpenChange,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const editor = useEditor();
	const [transcript, setTranscript] = useState<ProjectTranscript | null>(null);
	const [loading, setLoading] = useState(false);
	const wordRefs = useRef<Map<number, HTMLSpanElement>>(new Map());

	const projectId = editor.project.getActive()?.metadata.id;

	const loadTranscript = useCallback(async () => {
		if (!projectId) return;
		setLoading(true);
		const stored = await getProjectTranscript({ projectId });
		setTranscript(stored);
		setLoading(false);
	}, [projectId]);

	useEffect(() => {
		if (isOpen) {
			loadTranscript();
		}
	}, [isOpen, loadTranscript]);

	const handleGenerate = () => {
		onOpenChange(false);
		invokeAction("generate-transcript");
	};

	const handleRegenerate = async () => {
		if (!projectId) return;
		await deleteProjectTranscript({ projectId });
		onOpenChange(false);
		invokeAction("generate-transcript");
	};

	const handleWordClick = (word: TranscriptionWord) => {
		editor.playback.seek({ time: word.start });
	};

	const handleWordUpdate = useCallback(
		async (index: number, newText: string) => {
			if (!transcript || !projectId) return;

			const updatedWords = [...transcript.words];
			updatedWords[index] = { ...updatedWords[index], word: newText };

			// Rebuild the full text from updated words
			const updatedText = updatedWords.map((w) => w.word).join(" ");

			const updatedTranscript: ProjectTranscript = {
				...transcript,
				words: updatedWords,
				text: updatedText,
			};

			setTranscript(updatedTranscript);
			await setProjectTranscript({ projectId, transcript: updatedTranscript });
			toast.success("Word updated");
		},
		[transcript, projectId],
	);

	const handleCopyText = async () => {
		if (!transcript) return;
		await navigator.clipboard.writeText(transcript.text);
	};

	const handleExportJSON = () => {
		if (!transcript) return;
		const blob = new Blob([JSON.stringify(transcript, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "transcript.json";
		a.click();
		URL.revokeObjectURL(url);
	};

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent
				className="max-w-2xl"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle>Transcript</DialogTitle>
					<DialogDescription>
						{transcript
							? `${transcript.words.length} words · ${transcript.duration.toFixed(1)}s · Click to seek · Double-click to edit`
							: "Generate a word-level transcript from your timeline audio"}
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="p-0">
					{loading ? (
						<div className="flex items-center justify-center py-12">
							<p className="text-muted-foreground text-sm">Loading...</p>
						</div>
					) : transcript ? (
						<TranscriptWordView
							words={transcript.words}
							wordRefs={wordRefs}
							onWordClick={handleWordClick}
							onWordUpdate={handleWordUpdate}
							editor={editor}
						/>
					) : (
						<div className="flex flex-col items-center justify-center gap-3 py-12">
							<p className="text-muted-foreground text-sm">
								No transcript yet for this project.
							</p>
							<Button onClick={handleGenerate}>Generate Transcript</Button>
						</div>
					)}
				</DialogBody>

				{transcript && (
					<DialogFooter>
						<Button variant="outline" size="sm" onClick={handleRegenerate}>
							Regenerate
						</Button>
						<Button variant="outline" size="sm" onClick={handleCopyText}>
							Copy Text
						</Button>
						<Button variant="outline" size="sm" onClick={handleExportJSON}>
							Export JSON
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								onOpenChange(false);
								invokeAction("generate-scene-plan");
							}}
						>
							Generate Scene Plan →
						</Button>
						<Button onClick={() => onOpenChange(false)}>Done</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}

function TranscriptWordView({
	words,
	wordRefs,
	onWordClick,
	onWordUpdate,
	editor,
}: {
	words: TranscriptionWord[];
	wordRefs: React.MutableRefObject<Map<number, HTMLSpanElement>>;
	onWordClick: (word: TranscriptionWord) => void;
	onWordUpdate: (index: number, newText: string) => void;
	editor: ReturnType<typeof useEditor>;
}) {
	const [currentTime, setCurrentTime] = useState(0);
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [editValue, setEditValue] = useState("");
	const editInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		// Poll playback time to highlight the active word
		const interval = setInterval(() => {
			setCurrentTime(editor.playback.getCurrentTime());
		}, 100);
		return () => clearInterval(interval);
	}, [editor]);

	// Auto-focus the input when editing starts
	useEffect(() => {
		if (editingIndex !== null && editInputRef.current) {
			editInputRef.current.focus();
			editInputRef.current.select();
		}
	}, [editingIndex]);

	const startEditing = (index: number, word: string) => {
		setEditingIndex(index);
		setEditValue(word);
	};

	const commitEdit = () => {
		if (editingIndex === null) return;
		const trimmed = editValue.trim();
		if (trimmed && trimmed !== words[editingIndex].word) {
			onWordUpdate(editingIndex, trimmed);
		}
		setEditingIndex(null);
		setEditValue("");
	};

	const cancelEdit = () => {
		setEditingIndex(null);
		setEditValue("");
	};

	// Find the currently active word index
	const activeIndex = words.findIndex(
		(w) => currentTime >= w.start && currentTime < w.end,
	);

	return (
		<ScrollArea className="h-[400px] px-6 py-4">
			<p className="leading-relaxed text-sm flex flex-wrap gap-x-1 gap-y-0.5">
				{words.map((word, i) => {
					const isActive = i === activeIndex;
					const isEditing = i === editingIndex;

					if (isEditing) {
						return (
							<input
								key={i}
								ref={editInputRef}
								type="text"
								value={editValue}
								onChange={(e) => setEditValue(e.target.value)}
								onBlur={commitEdit}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										commitEdit();
									} else if (e.key === "Escape") {
										e.preventDefault();
										cancelEdit();
									}
								}}
								className="bg-primary/10 border-primary text-primary rounded border px-1 py-0 text-sm font-medium outline-none"
								style={{
									width: `${Math.max(editValue.length, 2) + 1}ch`,
								}}
							/>
						);
					}

					return (
						<span
							key={i}
							ref={(el) => {
								if (el) wordRefs.current.set(i, el);
								else wordRefs.current.delete(i);
							}}
							role="button"
							tabIndex={0}
							onClick={() => onWordClick(word)}
							onDoubleClick={() => startEditing(i, word.word)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") onWordClick(word);
							}}
							className={`cursor-pointer rounded px-0.5 transition-colors hover:bg-accent ${
								isActive
									? "bg-primary/20 text-primary font-medium"
									: "text-foreground"
							}`}
							title={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s · Double-click to edit`}
						>
							{word.word}
						</span>
					);
				})}
			</p>
		</ScrollArea>
	);
}
