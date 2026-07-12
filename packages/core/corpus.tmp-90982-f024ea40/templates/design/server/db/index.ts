import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import {
  DESIGN_AGENT_CONTEXT_ENDPOINT,
  DESIGN_AGENT_RESOURCE_KIND,
} from "../../shared/agent-readable.js";
import { publicDesignAccessRole } from "../lib/design-data-access.js";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

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
