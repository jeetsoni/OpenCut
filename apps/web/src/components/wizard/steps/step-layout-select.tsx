"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/ui";
import { useWizardStore } from "@/stores/wizard-store";
import { WIZARD_LAYOUTS, type WizardLayoutId } from "@/types/wizard";

export function StepLayoutSelect() {
	const router = useRouter();
	const { selectedLayout, setLayout, setStep } = useWizardStore();
	const [hovered, setHovered] = useState<WizardLayoutId | null>(null);

	const handleContinue = () => {
		if (!selectedLayout) return;
		setStep(1);
	};

	return (
		<div className="flex h-full flex-col items-center justify-center px-6 py-12">
			<div className="w-full max-w-3xl">
				<div className="mb-10 text-center">
					<h1 className="text-foreground text-3xl font-bold tracking-tight">
						Choose your layout
					</h1>
					<p className="text-muted-foreground mt-2 text-base">
						Select how you want your video to look. More layouts coming soon.
					</p>
				</div>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{WIZARD_LAYOUTS.map((layout) => {
						const isSelected = selectedLayout === layout.id;
						const isHovered = hovered === layout.id;

						return (
							<button
								key={layout.id}
								type="button"
								disabled={!layout.available}
								onClick={() => layout.available && setLayout(layout.id)}
								onMouseEnter={() => layout.available && setHovered(layout.id)}
								onMouseLeave={() => setHovered(null)}
								className={cn(
									"relative flex flex-col rounded-xl border-2 p-5 text-left transition-all",
									layout.available
										? "cursor-pointer"
										: "cursor-not-allowed opacity-40",
									isSelected
										? "border-primary bg-primary/5"
										: isHovered
											? "border-muted-foreground/40 bg-muted/30"
											: "border-border bg-card",
								)}
							>
								{/* Layout thumbnail placeholder */}
								<div className="mb-4 aspect-[9/16] w-full max-w-[80px] overflow-hidden rounded-lg bg-muted/50 self-center">
									<div className="flex h-full items-end justify-start p-1.5">
										<div className="h-8 w-8 rounded bg-muted-foreground/20" />
									</div>
								</div>

								<div className="flex items-start justify-between gap-2">
									<div>
										<p className="text-foreground text-sm font-semibold">
											{layout.name}
										</p>
										<p className="text-muted-foreground mt-1 text-xs leading-snug">
											{layout.description}
										</p>
									</div>
									{isSelected && (
										<div className="bg-primary mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
											<svg
												className="size-3 text-primary-foreground"
												viewBox="0 0 12 12"
												fill="none"
												aria-hidden="true"
											>
												<path
													d="M2 6l2.5 2.5L10 3"
													stroke="currentColor"
													strokeWidth="1.5"
													strokeLinecap="round"
													strokeLinejoin="round"
												/>
											</svg>
										</div>
									)}
								</div>

								{!layout.available && (
									<span className="absolute top-3 right-3 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
										Soon
									</span>
								)}
							</button>
						);
					})}
				</div>

				<div className="mt-8 flex items-center justify-between">
					<button
						type="button"
						onClick={() => router.push("/projects")}
						className="text-muted-foreground hover:text-foreground text-sm transition-colors"
					>
						Go to my projects
					</button>
					<Button
						onClick={handleContinue}
						disabled={!selectedLayout}
						size="lg"
					>
						Continue
					</Button>
				</div>
			</div>
		</div>
	);
}
