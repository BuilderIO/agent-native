import { createGetDb } from "@agent-native/core/db";
import { registerIdentityColumns } from "@agent-native/core/org";
import { registerShareableResource } from "@agent-native/core/sharing";

import { assertWorkspaceSharingPolicy } from "../model/sharing-settings-store.js";
import * as schema from "./schema.js";

/**
 * The workspace database handle. Queries are typed against the schema module,
 * so a column rename shows up as a type error at every call site.
 */
export const getDb = createGetDb(schema);
export { schema };

/** Register project sharing with the framework access controls. */
registerShareableResource({
  type: "analytics-project",
  resourceTable: schema.projects,
  sharesTable: schema.projectShares,
  displayName: "Project",
  allowPublic: false,
  requireOrgMemberForUserShares: true,
  assertSharingChange: assertWorkspaceSharingPolicy,
  titleColumn: "title",
  getResourcePath: (project) => `/project/${project.id}/latest`,
  getDb,
});

registerIdentityColumns([
  {
    table: "analytics2_thread_bootstraps",
    column: "owner_email",
    emailChange: "rekey",
    offboard: "retain",
    orgScope: { column: "org_id" },
    reason: "Keep private conversation intents attached to their owner.",
  },
  {
    table: "analytics2_thread_projects",
    column: "created_by",
    emailChange: "retain",
    offboard: "retain",
    orgScope: { column: "org_id" },
    reason: "Retain thread-binding attribution.",
  },
  {
    table: "analytics2_notebook_proposals",
    column: "decided_by",
    emailChange: "retain",
    offboard: "retain",
    orgScope: {
      column: "binding_id",
      references: {
        table: "analytics2_thread_projects",
        column: "binding_id",
        orgColumn: "org_id",
      },
    },
    reason: "Retain the actor recorded in a review decision.",
  },
  {
    table: "analytics2_notebook_proposal_receipts",
    column: "actor_id",
    emailChange: "rekey",
    offboard: "retain",
    orgScope: {
      column: "binding_id",
      references: {
        table: "analytics2_thread_projects",
        column: "binding_id",
        orgColumn: "org_id",
      },
    },
    reason:
      "Retain proposal replay for the same account after an email change.",
  },
  {
    table: "analytics2_notebook_legacy_proposal_dispositions",
    column: "actor_id",
    emailChange: "rekey",
    offboard: "retain",
    orgScope: {
      column: "project_id",
      references: {
        table: "analytics2_projects",
        column: "id",
        orgColumn: "org_id",
      },
    },
    reason:
      "Retain earlier-proposal disposition replay for the same project owner.",
  },
  {
    table: "analytics2_notebook_proposal_run_intents",
    column: "owner_email",
    emailChange: "rekey",
    offboard: "delete",
    orgScope: { column: "org_id" },
    reason:
      "Remove queued review execution when its actor leaves the workspace.",
  },
]);

registerShareableResource({
  type: "analytics-collection",
  resourceTable: schema.collections,
  sharesTable: schema.collectionShares,
  displayName: "Collection",
  allowPublic: false,
  requireOrgMemberForUserShares: true,
  assertSharingChange: assertWorkspaceSharingPolicy,
  titleColumn: "name",
  getResourcePath: (collection) => `/collection/${collection.id}`,
  getDb,
});
