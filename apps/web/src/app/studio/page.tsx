"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function StudioPage() {
	return (
		<div className="bg-background min-h-screen">
			{/* Header */}
			<header className="sticky top-0 z-20 flex items-center justify-between h-16 px-8 bg-background border-b border-border/50">
				<h1 className="text-foreground text-lg font-semibold">Studio</h1>
			</header>

			<main className="mx-auto max-w-5xl px-6 py-8">
				<EmptyState />
			</main>
		</div>
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
				<h3 className="text-lg font-medium">Studio</h3>
				<p className="text-muted-foreground max-w-sm text-sm">
					The studio feature has been removed from this application.
				</p>
			</div>
			<Link href="/">
				<Button size="lg">Go to Home</Button>
			</Link>
		</div>
	);
}
