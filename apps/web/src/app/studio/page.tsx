"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/utils/date";
import { cn } from "@/utils/ui";

interface WizardSessionSummary {
	projectId: string;
	currentStep: number;
	selectedLayout: string | null;
	uploadPhase: string;
	createdAt: string;
	updatedAt: string;
}

const STEP_LABELS = [
	"Choose Layout",
	"Upload Video",
	"Review Cuts",
	"Generate Animation",
] as const;

const STEP_COLORS = [
	"bg-muted text-muted-foreground",
	"bg-blue-500/15 text-blue-400",
	"bg-amber-500/15 text-amber-400",
	"bg-green-500/15 text-green-400",
] as const;

function stepBadge(session: WizardSessionSummary) {
	const step = Math.min(session.currentStep, 3) as 0 | 1 | 2 | 3;
	const isDone =
		step === 3 && session.uploadPhase === "done";
	if (isDone) {
		return { label: "Complete", color: "bg-primary/15 text-primary" };
	}
	return { label: `Step ${step + 1}: ${STEP_LABELS[step]}`, color: STEP_COLORS[step] };
}

function shortId(projectId: string) {
	return projectId.slice(-6).toUpperCase();
}

export default function StudioPage() {
	const [sessions, setSessions] = useState<WizardSessionSummary[] | null>(null);

	useEffect(() => {
		void fetch("/api/wizard")
			.then((r) => r.json())
			.then((data) => setSessions(data as WizardSessionSummary[]));
	}, []);

	return (
		<div className="bg-background min-h-screen">
			{/* Header */}
			<header className="sticky top-0 z-20 flex items-center justify-between h-16 px-8 bg-background border-b border-border/50">
				<h1 className="text-foreground text-lg font-semibold">Studio</h1>
				<Link href="/studio/new">
					<Button size="lg">New project</Button>
				</Link>
			</header>

			<main className="mx-auto max-w-5xl px-6 py-8">
				{sessions === null ? (
					<LoadingSkeleton />
				) : sessions.length === 0 ? (
					<EmptyState />
				) : (
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{sessions.map((session) => (
							<ProjectCard key={session.projectId} session={session} />
						))}
					</div>
				)}
			</main>
		</div>
	);
}

function ProjectCard({ session }: { session: WizardSessionSummary }) {
	const badge = stepBadge(session);

	return (
		<Link
			href={`/studio/${session.projectId}`}
			className="group block rounded-xl border border-border bg-card hover:border-border/80 hover:bg-card/80 transition-colors p-5"
		>
			{/* Thumbnail placeholder */}
			<div className="bg-muted rounded-lg aspect-video mb-4 flex items-center justify-center">
				<span className="text-muted-foreground text-xs font-mono">
					{shortId(session.projectId)}
				</span>
			</div>

			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="text-foreground text-sm font-medium truncate">
						Project {shortId(session.projectId)}
					</p>
					<p className="text-muted-foreground text-xs mt-0.5">
						Updated {formatDate({ date: new Date(session.updatedAt) })}
					</p>
				</div>
				<span
					className={cn(
						"shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
						badge.color,
					)}
				>
					{badge.label}
				</span>
			</div>
		</Link>
	);
}

function EmptyState() {
	return (
		<div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
			<div className="flex flex-col items-center gap-2">
				<div className="bg-muted/30 flex size-16 items-center justify-center rounded-full">
					<svg
						className="text-muted-foreground size-8"
						fill="none"
						stroke="currentColor"
						strokeWidth={1.5}
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
						/>
					</svg>
				</div>
				<h3 className="text-lg font-medium">No studio projects yet</h3>
				<p className="text-muted-foreground max-w-sm text-sm">
					Create your first project and let the wizard guide you from upload to
					finished animation.
				</p>
			</div>
			<Link href="/studio/new">
				<Button size="lg">Create first project</Button>
			</Link>
		</div>
	);
}

function LoadingSkeleton() {
	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{Array.from({ length: 6 }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
				<div key={i} className="rounded-xl border border-border bg-card p-5">
					<Skeleton className="aspect-video w-full rounded-lg mb-4" />
					<Skeleton className="h-4 w-2/3 mb-2" />
					<Skeleton className="h-3 w-1/3" />
				</div>
			))}
		</div>
	);
}
