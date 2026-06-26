import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "dashboard",
  resourceTable: schema.dashboards,
  sharesTable: schema.dashboardShares,
  displayName: "Dashboard",
  titleColumn: "title",
  getResourcePath: (dashboard) => `/dashboards/${dashboard.id}`,
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

registerShareableResource({
  type: "strategic-account",
  resourceTable: schema.strategicAccounts,
  sharesTable: schema.strategicAccountShares,
  displayName: "Strategic Account",
  titleColumn: "companyName",
  getResourcePath: () => `/dashboards/strategic-accounts`,
  getDb,
});

registerShareableResource({
  type: "strategic-account-contact",
  resourceTable: schema.strategicAccountContacts,
  sharesTable: schema.strategicAccountContactShares,
  displayName: "Strategic Account Contact",
  titleColumn: "contactName",
  getResourcePath: () => `/dashboards/strategic-account-coverage`,
  getDb,
});

registerShareableResource({
  type: "implementation-blocker",
  resourceTable: schema.implementationBlockers,
  sharesTable: schema.implementationBlockerShares,
  displayName: "Implementation Blocker",
  titleColumn: "summary",
  getResourcePath: () => `/dashboards/implementation-blockers`,
  getDb,
});
