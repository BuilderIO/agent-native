import * as schema from "./schema.js";
import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "dashboard",
  resourceTable: schema.dashboards,
  sharesTable: schema.dashboardShares,
  displayName: "Dashboard",
  titleColumn: "title",
  getResourcePath: (dashboard) => `/adhoc/${dashboard.id}`,
  getDb,
});

registerShareableResource({
  type: "analysis",
  resourceTable: schema.analyses,
  sharesTable: schema.analysisShares,
  displayName: "Analysis",
  titleColumn: "name",
  getResourcePath: (analysis) => `/analyses/${analysis.id}`,
  getDb,
});
