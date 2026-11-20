import { runMigrations } from "@agent-native/core/db";

import "../db/index.js";
import { journeysMigrations } from "../db/migrations.js";

export default runMigrations(journeysMigrations, {
  table: "journeys_migrations",
});
