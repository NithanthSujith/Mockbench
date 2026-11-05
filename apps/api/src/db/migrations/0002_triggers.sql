CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON "workspaces" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER workspace_members_set_updated_at BEFORE UPDATE ON "workspace_members" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON "projects" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER routes_set_updated_at BEFORE UPDATE ON "routes" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER response_cases_set_updated_at BEFORE UPDATE ON "response_cases" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER data_presets_set_updated_at BEFORE UPDATE ON "data_presets" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER versions_immutable BEFORE UPDATE ON "versions" FOR EACH ROW EXECUTE FUNCTION versions_reject_update();
