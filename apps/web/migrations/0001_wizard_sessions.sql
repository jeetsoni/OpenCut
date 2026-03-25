CREATE TABLE "wizard_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"current_step" integer NOT NULL DEFAULT 0,
	"selected_layout" text,
	"upload_phase" text NOT NULL DEFAULT 'idle',
	"removed_segments" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"pre_processing_tracks" jsonb,
	"post_processing_tracks" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "wizard_sessions_project_id_unique" UNIQUE("project_id")
);
