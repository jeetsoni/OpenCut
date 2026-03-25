import { type NextRequest, NextResponse } from "next/server";
import { db, wizardSessions } from "@/lib/db";
import { eq } from "drizzle-orm";
import { generateUUID } from "@/utils/id";

export async function GET(
	_req: NextRequest,
	{ params }: { params: Promise<{ project_id: string }> },
) {
	const { project_id } = await params;

	const [session] = await db
		.select()
		.from(wizardSessions)
		.where(eq(wizardSessions.projectId, project_id))
		.limit(1);

	if (!session) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	return NextResponse.json(session);
}

export async function PUT(
	req: NextRequest,
	{ params }: { params: Promise<{ project_id: string }> },
) {
	const { project_id } = await params;
	const body = (await req.json()) as {
		currentStep: number;
		selectedLayout: string | null;
		uploadPhase: string;
		removedSegments: unknown[];
		preProcessingTracks: unknown[] | null;
		postProcessingTracks: unknown[] | null;
	};

	const now = new Date();

	await db
		.insert(wizardSessions)
		.values({
			id: generateUUID(),
			projectId: project_id,
			currentStep: body.currentStep,
			selectedLayout: body.selectedLayout ?? null,
			uploadPhase: body.uploadPhase,
			removedSegments: body.removedSegments,
			preProcessingTracks: body.preProcessingTracks ?? null,
			postProcessingTracks: body.postProcessingTracks ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: wizardSessions.projectId,
			set: {
				currentStep: body.currentStep,
				selectedLayout: body.selectedLayout ?? null,
				uploadPhase: body.uploadPhase,
				removedSegments: body.removedSegments,
				preProcessingTracks: body.preProcessingTracks ?? null,
				postProcessingTracks: body.postProcessingTracks ?? null,
				updatedAt: now,
			},
		});

	return NextResponse.json({ ok: true });
}
