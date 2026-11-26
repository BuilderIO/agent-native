import { createGetDb } from "@agent-native/core/db";
import { registerIdentityColumns } from "@agent-native/core/org";
import { registerShareableResource } from "@agent-native/core/sharing";

import {
  DESIGN_AGENT_CONTEXT_ENDPOINT,
  DESIGN_AGENT_RESOURCE_KIND,
} from "../../shared/agent-readable.js";
import { designSharePath } from "../../shared/visual-edit-preview.js";
import { capabilityDesignAccessRole } from "../lib/design-data-access.js";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerIdentityColumns([
  {
    table: "design_review_agent_requests",
    column: "requester_email",
    emailChange: "rekey",
    offboard: "retain",
    orgScope: {
      column: "design_id",
      references: { table: "designs", column: "id", orgColumn: "org_id" },
    },
    reason:
      "Rekeying keeps cancel authority and attribution after an email change; requests remain as design review history when a member leaves.",
  },
]);

registerShareableResource({
  type: "design",
  agentRead: { actions: ["get-design"] },
  resourceTable: schema.designs,
  sharesTable: schema.designShares,
  displayName: "Design",
  titleColumn: "title",
  getResourcePath: (design) => designSharePath(String(design.id), design.data),
  agentReadable: {
    resourceKind: DESIGN_AGENT_RESOURCE_KIND,
    getContextPath: () => DESIGN_AGENT_CONTEXT_ENDPOINT,
  },
  getDb,
  capabilityAccessRole: capabilityDesignAccessRole,
  ownerAccessIgnoresOrg: true,
});

registerShareableResource({
  type: "design-template",
  agentRead: { actions: ["get-design-template"], idParam: "templateId" },
  resourceTable: schema.designTemplates,
  sharesTable: schema.designTemplateShares,
  displayName: "Design template",
  titleColumn: "title",
  getResourcePath: (template) => `/templates?templateId=${template.id}`,
  getDb,
});
