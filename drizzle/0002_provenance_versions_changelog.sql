CREATE TABLE "change_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"op" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_counters" (
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "org_counters_organization_id_name_pk" PRIMARY KEY("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "sync_ops" (
	"op_id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid,
	"user_id" uuid NOT NULL,
	"command" text NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text NOT NULL,
	"http_status" integer NOT NULL,
	"result" jsonb,
	"device_created_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_progress_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"progress" integer NOT NULL,
	"actual_quantity" numeric(18, 3),
	"applied" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"origin" text DEFAULT 'online' NOT NULL,
	"device_id" uuid,
	"device_created_at" timestamp with time zone,
	"server_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"op_id" uuid
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "origin" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "device_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "origin" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "device_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "server_received_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "op_id" uuid;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "local_ref" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "origin" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "device_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "server_received_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "op_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "origin" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "device_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "server_received_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "op_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "progress_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_counters" ADD CONSTRAINT "org_counters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_ops" ADD CONSTRAINT "sync_ops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_progress_log" ADD CONSTRAINT "task_progress_log_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_progress_log" ADD CONSTRAINT "task_progress_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_progress_log" ADD CONSTRAINT "task_progress_log_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_log_org_seq_idx" ON "change_log" USING btree ("organization_id","seq");--> statement-breakpoint
CREATE INDEX "change_log_changed_at_idx" ON "change_log" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "task_progress_task_idx" ON "task_progress_log" USING btree ("task_id","device_created_at");--> statement-breakpoint
-- Бэкфилл существующих строк: факты до 0.3.0 введены онлайн, приняты сервером в момент создания; время устройства неизвестно (NULL).
UPDATE "expenses" SET "server_received_at" = "created_at";--> statement-breakpoint
UPDATE "stock_movements" SET "server_received_at" = "created_at";--> statement-breakpoint
UPDATE "purchases" SET "server_received_at" = "created_at", "updated_at" = "created_at";--> statement-breakpoint
UPDATE "projects" SET "updated_at" = "created_at";--> statement-breakpoint
UPDATE "tasks" SET "updated_at" = "created_at";--> statement-breakpoint
UPDATE "approvals" SET "updated_at" = coalesce("decided_at", "created_at");--> statement-breakpoint
UPDATE "materials" SET "updated_at" = "created_at";--> statement-breakpoint
UPDATE "counterparties" SET "updated_at" = "created_at";--> statement-breakpoint
UPDATE "contracts" SET "updated_at" = "created_at";--> statement-breakpoint
UPDATE "budget_lines" SET "updated_at" = "created_at";
