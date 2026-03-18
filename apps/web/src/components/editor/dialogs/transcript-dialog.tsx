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
	deleteProjectTranscript,
} from "@/lib/transcription/transcript-store";
import type { ProjectTranscript, TranscriptionWord } from "@/types/transcription";
import { invokeAction } from "@/lib/actions";

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
							? `${transcript.words.length} words · ${transcript.duration.toFixed(1)}s · Click any word to seek`
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
	editor,
}: {
	words: TranscriptionWord[];
	wordRefs: React.MutableRefObject<Map<number, HTMLSpanElement>>;
	onWordClick: (word: TranscriptionWord) => void;
	editor: ReturnType<typeof useEditor>;
}) {
	const [currentTime, setCurrentTime] = useState(0);

	useEffect(() => {
		// Poll playback time to highlight the active word
		const interval = setInterval(() => {
			setCurrentTime(editor.playback.getCurrentTime());
		}, 100);
		return () => clearInterval(interval);
	}, [editor]);

	// Find the currently active word index
	const activeIndex = words.findIndex(
		(w) => currentTime >= w.start && currentTime < w.end,
	);

	return (
		<ScrollArea className="h-[400px] px-6 py-4">
			<p className="leading-relaxed text-sm flex flex-wrap gap-x-1 gap-y-0.5">
				{words.map((word, i) => {
					const isActive = i === activeIndex;
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
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") onWordClick(word);
							}}
							className={`cursor-pointer rounded px-0.5 transition-colors hover:bg-accent ${
								isActive
									? "bg-primary/20 text-primary font-medium"
									: "text-foreground"
							}`}
							title={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s`}
						>
							{word.word}
						</span>
					);
				})}
			</p>
		</ScrollArea>
	);
}
