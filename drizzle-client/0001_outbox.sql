CREATE TABLE "local_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"op_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"op_id" uuid PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"command" text NOT NULL,
	"payload" jsonb NOT NULL,
	"device_created_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"entity_id" uuid,
	"depends_on" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"error_code" text,
	"error" text,
	"conflict_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "outbox_seq_unique" UNIQUE("seq")
);
--> statement-breakpoint
ALTER TABLE "local_rows" ADD CONSTRAINT "local_rows_op_id_outbox_op_id_fk" FOREIGN KEY ("op_id") REFERENCES "public"."outbox"("op_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "local_rows_op_idx" ON "local_rows" USING btree ("op_id");--> statement-breakpoint
CREATE INDEX "local_rows_entity_idx" ON "local_rows" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "outbox" USING btree ("status","seq");