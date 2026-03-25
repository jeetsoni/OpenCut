"use client";

import { useParams } from "next/navigation";
import { WizardProvider } from "@/components/wizard/wizard-provider";
import { WizardShell } from "@/components/wizard/wizard-shell";

export default function StudioProjectPage() {
	const params = useParams();
	const projectId = params.project_id as string;

	return (
		<WizardProvider projectId={projectId}>
			<WizardShell projectId={projectId} />
		</WizardProvider>
	);
}
