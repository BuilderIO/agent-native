import { runMigrations } from "@agent-native/core/db";

export default runMigrations([], { table: "issues_migrations" });
