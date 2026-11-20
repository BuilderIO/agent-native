import { createGetDb } from "@agent-native/core/db";
import { registerIdentityColumns } from "@agent-native/core/org";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerIdentityColumns([
  {
    table: "forms_workspaces",
    column: "created_by",
    emailChange: "rekey",
    offboard: "retain",
    orgScope: { column: "org_id" },
    reason:
      "Attribution, and the access key for a workspace outside an organization.",
  },
  {
    table: "forms_submissions",
    column: "session_id",
    emailChange: "retain",
    offboard: "retain",
    reason: "Anonymous respondent browser session, never a member identity.",
  },
  {
    table: "forms_events",
    column: "session_id",
    emailChange: "retain",
    offboard: "retain",
    reason: "Anonymous respondent browser session, never a member identity.",
  },
  {
    table: "forms_form_versions",
    column: "author",
    emailChange: "retain",
    offboard: "retain",
    orgScope: { column: "org_id" },
    reason:
      "Who saved the snapshot; history keeps the name it was saved under.",
  },
  {
    table: "forms_domains",
    column: "created_by",
    emailChange: "retain",
    offboard: "retain",
    orgScope: { column: "org_id" },
    reason:
      "Who added the domain; the host belongs to the org, not the member.",
  },
]);
