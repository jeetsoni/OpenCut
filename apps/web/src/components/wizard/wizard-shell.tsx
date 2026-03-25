"use client";

import { useWizardStore } from "@/stores/wizard-store";
import { useWizardPersistence } from "@/hooks/use-wizard-persistence";
import { WizardProgressBar } from "./wizard-progress-bar";
import { StepLayoutSelect } from "./steps/step-layout-select";
import { StepUpload } from "./steps/step-upload";
import { StepReviewCuts } from "./steps/step-review-cuts";
import { StepGenerateAnimation } from "./steps/step-generate-animation";

export function WizardShell({ projectId }: { projectId: string }) {
	const currentStep = useWizardStore((s) => s.currentStep);
	useWizardPersistence(projectId);

	return (
		<div className="flex h-screen flex-col">
			<WizardProgressBar currentStep={currentStep} />
			<div className="flex-1 overflow-auto">
				{currentStep === 0 && <StepLayoutSelect />}
				{currentStep === 1 && <StepUpload />}
				{currentStep === 2 && <StepReviewCuts />}
				{currentStep === 3 && <StepGenerateAnimation />}
			</div>
		</div>
	);
}
