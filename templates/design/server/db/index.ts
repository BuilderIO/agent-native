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
    table: "design_native_texture_objects",
    column: "uploader_email",
    emailChange: "rekey",
    offboard: "retain",
    reason:
      "Shared Design copies continue to read the registered provider object after its uploader leaves.",
  },
  {
    table: "design_native_texture_assets",
    column: "uploader_email",
    emailChange: "rekey",
    offboard: "retain",
    reason:
      "The uploaded bytes remain part of the Design after a collaborator leaves; the uploader address scopes provider reads.",
  },
  {
    table: "design_native_shader_library",
    column: "owner_email",
    emailChange: "rekey",
    offboard: "delete",
    reason: "Private reusable shader definitions belong to their author.",
  },
  {
    table: "design_native_shader_library_activity",
    column: "owner_email",
    emailChange: "rekey",
    offboard: "delete",
    reason:
      "Private shader favorites and recent-use state belong to the viewer.",
  },
]);

registerShareableResource({
  type: "design",
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
  resourceTable: schema.designTemplates,
  sharesTable: schema.designTemplateShares,
  displayName: "Design template",
  titleColumn: "title",
  getResourcePath: (template) => `/templates?templateId=${template.id}`,
  getDb,
});

registerShareableResource({
  type: "design-system",
  resourceTable: schema.designSystems,
  sharesTable: schema.designSystemShares,
  displayName: "Design System",
  titleColumn: "title",
  getResourcePath: (designSystem) =>
    `/design-systems?designSystemId=${designSystem.id}`,
  getDb,
});
