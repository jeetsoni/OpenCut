import { NextResponse } from "next/server";
import { db, wizardSessions } from "@/lib/db";
import { desc } from "drizzle-orm";

export async function GET() {
	const sessions = await db
		.select({
			projectId: wizardSessions.projectId,
			currentStep: wizardSessions.currentStep,
			selectedLayout: wizardSessions.selectedLayout,
			uploadPhase: wizardSessions.uploadPhase,
			createdAt: wizardSessions.createdAt,
			updatedAt: wizardSessions.updatedAt,
		})
		.from(wizardSessions)
		.orderBy(desc(wizardSessions.updatedAt));

	return NextResponse.json(sessions);
}
