CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "data_presets" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"project_id" uuid NOT NULL,
	"version_id" uuid,
	"version_label" text NOT NULL,
	"deployed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version_seq" integer DEFAULT 0 NOT NULL,
	"active_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug"),
	CONSTRAINT "projects_slug_format" CHECK ("projects"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("projects"."slug") between 3 and 40)
);
--> statement-breakpoint
CREATE TABLE "request_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"project_id" uuid NOT NULL,
	"version_id" uuid,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"matched_route_id" uuid,
	"matched_case_id" uuid,
	"route_pattern" text,
	"case_name" text,
	"status_code" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"mock_error" text,
	"request_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"query" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "response_cases" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"route_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status_code" integer NOT NULL,
	"schema" jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"delay_ms" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "response_cases_status_code_check" CHECK ("response_cases"."status_code" in (200,201,202,204,400,401,403,404,409,422,429,500,502,503)),
	CONSTRAINT "response_cases_delay_ms_check" CHECK ("response_cases"."delay_ms" is null or "response_cases"."delay_ms" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"project_id" uuid NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"normalized_path" text GENERATED ALWAYS AS (lower(regexp_replace(path, ':[A-Za-z_][A-Za-z0-9_]*', '{}', 'g'))) STORED,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routes_project_method_normalized_unique" UNIQUE("project_id","method","normalized_path"),
	CONSTRAINT "routes_method_check" CHECK ("routes"."method" in ('GET','POST','PUT','PATCH','DELETE'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"label" text NOT NULL,
	"notes" text,
	"snapshot" jsonb NOT NULL,
	"baked" text,
	"route_count" integer NOT NULL,
	"case_count" integer NOT NULL,
	"snapshot_bytes" integer NOT NULL,
	"baked_bytes" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "versions_project_seq_unique" UNIQUE("project_id","seq"),
	CONSTRAINT "versions_project_label_unique" UNIQUE("project_id","label")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_user_unique" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug"),
	CONSTRAINT "workspaces_slug_format" CHECK ("workspaces"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("workspaces"."slug") between 2 and 40)
);
--> statement-breakpoint
ALTER TABLE "data_presets" ADD CONSTRAINT "data_presets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_deployed_by_users_id_fk" FOREIGN KEY ("deployed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_active_version_id_versions_id_fk" FOREIGN KEY ("active_version_id") REFERENCES "public"."versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_cases" ADD CONSTRAINT "response_cases_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_presets_project_idx" ON "data_presets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "deployments_project_created_idx" ON "deployments" USING btree ("project_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "projects_workspace_created_idx" ON "projects" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "request_logs_project_created_idx" ON "request_logs" USING btree ("project_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "response_cases_route_name_unique" ON "response_cases" USING btree ("route_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "response_cases_one_default_per_route" ON "response_cases" USING btree ("route_id") WHERE "response_cases"."is_default";--> statement-breakpoint
CREATE INDEX "response_cases_route_sort_idx" ON "response_cases" USING btree ("route_id","sort_order");--> statement-breakpoint
CREATE INDEX "routes_project_sort_idx" ON "routes" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "versions_project_created_idx" ON "versions" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members" USING btree ("user_id");