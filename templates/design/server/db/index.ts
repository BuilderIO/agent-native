import { createGetDb } from "@agent-native/core/db";
import { registerIdentityColumns } from "@agent-native/core/org";
import { registerShareableResource } from "@agent-native/core/sharing";

import {
  DESIGN_AGENT_CONTEXT_ENDPOINT,
  DESIGN_AGENT_RESOURCE_KIND,
} from "../../shared/agent-readable.js";
import { publicDesignAccessRole } from "../lib/design-data-access.js";
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
  getResourcePath: (design) => `/design/${design.id}`,
  agentReadable: {
    resourceKind: DESIGN_AGENT_RESOURCE_KIND,
    getContextPath: () => DESIGN_AGENT_CONTEXT_ENDPOINT,
  },
  getDb,
  publicAccessRole: publicDesignAccessRole,
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

registerShareableResource({
  type: "design-system",
  agentRead: { actions: ["get-design-system"] },
  resourceTable: schema.designSystems,
  sharesTable: schema.designSystemShares,
  displayName: "Design System",
  titleColumn: "title",
  getResourcePath: (designSystem) =>
    `/design-systems?designSystemId=${designSystem.id}`,
  getDb,
});
