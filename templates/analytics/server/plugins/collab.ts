import { createCollabPlugin } from "@agent-native/core/server";

export default createCollabPlugin({
  table: "dashboards",
  contentColumn: "config",
  idColumn: "id",
  autoSeed: true,
  resolveCollabDocumentId: (dashboardId) => `dash-${dashboardId}`,
  resolveSourceIdFromCollabDocumentId: (docId) =>
    docId.startsWith("dash-") ? docId.slice("dash-".length) : docId,
  access: {
    mode: "resource",
    resourceType: "dashboard",
    resolveResourceId: (docId) =>
      docId.startsWith("dash-") ? docId.slice("dash-".length) : docId,
  },
});
