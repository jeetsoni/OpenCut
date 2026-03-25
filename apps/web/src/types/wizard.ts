export type WizardLayoutId = "full-video-animation";

export interface WizardLayout {
	id: WizardLayoutId;
	name: string;
	description: string;
	available: boolean;
}

export const WIZARD_LAYOUTS: WizardLayout[] = [
	{
		id: "full-video-animation",
		name: "Full Video Animation",
		description:
			"Face cam PiP with AI-generated animated overlays across your entire video.",
		available: true,
	},
];
