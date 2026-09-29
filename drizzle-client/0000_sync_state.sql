CREATE TABLE "sync_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"server_url" text NOT NULL,
	"device_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_role" text NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"last_pull_at" timestamp with time zone,
	"last_push_at" timestamp with time zone,
	"protocol_version" integer DEFAULT 1 NOT NULL,
	"offline_scope" jsonb,
	"effective_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot_required" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
