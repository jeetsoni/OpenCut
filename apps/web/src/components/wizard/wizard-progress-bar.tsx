"use client";

import { cn } from "@/utils/ui";

const STEPS = ["Choose Layout", "Upload Video", "Review Cuts", "Generate"];

interface WizardProgressBarProps {
	currentStep: number;
}

export function WizardProgressBar({ currentStep }: WizardProgressBarProps) {
	return (
		<div className="border-b border-border bg-background px-6 py-4">
			<div className="mx-auto flex max-w-3xl items-center justify-between">
				{STEPS.map((label, index) => {
					const isDone = index < currentStep;
					const isActive = index === currentStep;

					return (
						<div key={label} className="flex flex-1 items-center">
							<div className="flex flex-col items-center gap-1.5">
								<div
									className={cn(
										"flex size-8 items-center justify-center rounded-full text-sm font-semibold transition-colors",
										isDone &&
											"bg-primary text-primary-foreground",
										isActive &&
											"border-2 border-primary text-primary",
										!isDone &&
											!isActive &&
											"border-2 border-muted-foreground/30 text-muted-foreground/50",
									)}
								>
									{isDone ? (
										<svg
											className="size-4"
											viewBox="0 0 16 16"
											fill="none"
											aria-hidden="true"
										>
											<path
												d="M3 8l3.5 3.5L13 4.5"
												stroke="currentColor"
												strokeWidth="2"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
									) : (
										index + 1
									)}
								</div>
								<span
									className={cn(
										"text-xs font-medium whitespace-nowrap",
										isActive ? "text-foreground" : "text-muted-foreground/60",
									)}
								>
									{label}
								</span>
							</div>

							{index < STEPS.length - 1 && (
								<div
									className={cn(
										"mx-3 h-0.5 flex-1 transition-colors",
										isDone ? "bg-primary" : "bg-muted-foreground/20",
									)}
								/>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
