"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useEditor } from "@/hooks/use-editor";
import { useEditorActions } from "@/hooks/actions/use-editor-actions";
import { prefetchFontAtlas } from "@/lib/fonts/google-fonts";

interface WizardProviderProps {
	projectId: string;
	children: React.ReactNode;
}

export function WizardProvider({ projectId, children }: WizardProviderProps) {
	const editor = useEditor();
	const router = useRouter();
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const activeProject = editor.project.getActiveOrNull();

	useEffect(() => {
		let cancelled = false;

		const loadProject = async () => {
			try {
				setIsLoading(true);

				// "new" is a sentinel — create a fresh project and redirect immediately
				if (projectId === "new") {
					const newProjectId = await editor.project.createNewProject({
						name: "Untitled Project",
					});
					if (!cancelled) router.replace(`/studio/${newProjectId}`);
					return;
				}

				await editor.project.loadProject({ id: projectId });

				if (cancelled) return;

				setIsLoading(false);
				prefetchFontAtlas();
			} catch (err) {
				if (cancelled) return;

				setError(
					err instanceof Error ? err.message : "Failed to load project",
				);
				setIsLoading(false);
			}
		};

		loadProject();

		return () => {
			cancelled = true;
		};
	}, [projectId, editor, router]);

	if (error) {
		return (
			<div className="bg-background flex h-screen w-screen items-center justify-center">
				<p className="text-destructive text-sm">{error}</p>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="bg-background flex h-screen w-screen items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<Loader2 className="text-muted-foreground size-8 animate-spin" />
					<p className="text-muted-foreground text-sm">Loading project...</p>
				</div>
			</div>
		);
	}

	if (!activeProject) {
		return (
			<div className="bg-background flex h-screen w-screen items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<Loader2 className="text-muted-foreground size-8 animate-spin" />
					<p className="text-muted-foreground text-sm">Exiting project...</p>
				</div>
			</div>
		);
	}

	return (
		<>
			<WizardRuntimeBindings />
			{children}
		</>
	);
}

function WizardRuntimeBindings() {
	useEditorActions();
	// Intentionally no useKeybindingsListener — wizard has no keyboard shortcuts
	return null;
}
