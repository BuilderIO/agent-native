import { defineStore } from "../db/store-registry.js";
import { fromMigrationEntries } from "../db/versioned-store-migrations.js";
import { ORG_MIGRATIONS } from "./migrations.js";

export const orgStore = defineStore({
  id: "org",
  // Entries 1024 and 1032 touch the review-suggestion and audit tables; on main
  // every store ran before this list, so keep that order at release.
  after: ["audit", "review_suggestions"],
  migrations: fromMigrationEntries("_org_migrations", ORG_MIGRATIONS, {
    ranAtBoot: true,
    data: [1009, 1018],
  }),
});
