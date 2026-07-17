import { createHash } from "node:crypto";

import { putPrivateBlob } from "@agent-native/core/private-blob";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import type { NativeResourceCaptureAdapter } from "@agent-native/creative-context/server";

import { getDb, schema } from "../db/index.js";
import { getDashboard } from "./dashboards-store.js";

function syntheticPreview(config: Record<string, unknown>) {
  const panels = Array.isArray(config.panels) ? config.panels : [];
  return panels.slice(0, 24).map((panel: any, index) => ({
    id: typeof panel?.id === "string" ? panel.id : String(index),
    title: typeof panel?.title === "string" ? panel.title : `Panel ${index + 1}`,
    visualization: typeof panel?.visualization === "string" ? panel.visualization : typeof panel?.type === "string" ? panel.type : "chart",
    data: "synthetic",
  }));
}

export const nativeDashboardCreativeContextAdapter: NativeResourceCaptureAdapter = {
  appId: "analytics",
  resourceType: "dashboard",
  async capture(reference) {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const dashboard = await getDashboard(reference.resourceId, { email, orgId: getRequestOrgId() ?? null });
    if (!dashboard) throw new Error("Dashboard not found");
    if (reference.expectedUpdatedAt && reference.expectedUpdatedAt !== dashboard.updatedAt) throw new Error("Dashboard changed before it could be submitted to Context.");
    const payload = JSON.stringify({ id: dashboard.id, kind: dashboard.kind, title: dashboard.title, config: dashboard.config, updatedAt: dashboard.updatedAt });
    const contentHash = createHash("sha256").update(payload).digest("hex");
    const revisionId = `context-${Date.now()}-${contentHash.slice(0, 12)}`;
    await getDb().insert(schema.dashboardRevisions).values({ id: revisionId, dashboardId: dashboard.id, kind: dashboard.kind, title: dashboard.title, config: JSON.stringify(dashboard.config), createdAt: new Date().toISOString(), createdBy: email, ownerEmail: dashboard.ownerEmail, orgId: dashboard.orgId });
    const handle = await putPrivateBlob({ data: Buffer.from(payload), filename: `${dashboard.id}.dashboard.json`, mimeType: "application/json", ownerEmail: dashboard.ownerEmail, key: `creative-context/analytics/${dashboard.id}/${contentHash}.json`, metadata: { appId: "analytics", resourceType: "dashboard", resourceId: dashboard.id, contentHash } });
    if (!handle) throw new Error("Private blob storage is required to submit a dashboard to Context.");
    const preview = syntheticPreview(dashboard.config);
    return { artifactKey: `analytics:dashboard:${dashboard.id}`, source: { name: "Analytics", kind: "native-app", externalRef: dashboard.id }, items: [{ externalId: `native:analytics:dashboard:${dashboard.id}`, kind: "dashboard", title: dashboard.title, canonicalUrl: `/adhoc/sql-dashboard/${dashboard.id}`, mimeType: "application/json", content: preview.map((panel) => `${panel.title} (${panel.visualization})`).join("\n"), summary: `${preview.length} dashboard panels represented with synthetic preview data only.`, contentHash, sourceModifiedAt: dashboard.updatedAt, sourceVersion: revisionId, metadata: { preview: { type: "dashboard", data: "synthetic", panels: preview } } }], privateMetadata: { nativeResource: { appId: "analytics", resourceType: "dashboard", resourceId: dashboard.id, expectedUpdatedAt: reference.expectedUpdatedAt }, clone: { handle, appId: "analytics", resourceType: "dashboard", resourceId: dashboard.id, contentHash, sourceVersion: revisionId, updatedAt: dashboard.updatedAt } } };
  },
};
