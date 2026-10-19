import { createHash } from "node:crypto";

import { isOrgMember } from "@agent-native/core/org";
import { putPrivateBlob } from "@agent-native/core/private-blob";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import type { NativeResourceCaptureAdapter } from "@agent-native/creative-context/server";
import { and, eq, inArray, or, sql } from "drizzle-orm";

import {
  BUILTIN_DASHBOARD_HIDDEN_BY,
  builtinDashboardIdFor,
} from "../../shared/builtin-dashboard-ids.js";
import { getDb, schema } from "../db/index.js";
import { loadBuiltinDashboard } from "./builtin-dashboards.js";
import { openDashboard } from "./open-dashboard.js";

function syntheticPreview(config: Record<string, unknown>) {
  const panels = Array.isArray(config.panels) ? config.panels : [];
  return panels.slice(0, 24).map((panel: any, index) => ({
    id: typeof panel?.id === "string" ? panel.id : String(index),
    title:
      typeof panel?.title === "string" ? panel.title : `Panel ${index + 1}`,
    visualization:
      typeof panel?.visualization === "string"
        ? panel.visualization
        : typeof panel?.type === "string"
          ? panel.type
          : "chart",
    data: "synthetic",
  }));
}

export const nativeDashboardCreativeContextAdapter: NativeResourceCaptureAdapter =
  {
    appId: "analytics",
    resourceType: "dashboard",
    async listResourceVersions(resourceIds) {
      if (!resourceIds.length) return [];
      const email = getRequestUserEmail();
      if (!email) throw new Error("no authenticated user");
      const scope = { email, orgId: getRequestOrgId() ?? null };
      const accessible = accessFilter(
        schema.dashboards,
        schema.dashboardShares,
        { userEmail: email, orgId: scope.orgId ?? undefined },
        "viewer",
        { includePublic: true },
      );
      const rows = await getDb()
        .select({
          id: schema.dashboards.id,
          updatedAt: schema.dashboards.updatedAt,
          hiddenBy: schema.dashboards.hiddenBy,
          orgId: schema.dashboards.orgId,
          accessible: sql<boolean>`${accessible}`,
        })
        .from(schema.dashboards)
        .where(
          and(
            or(
              accessible,
              and(
                eq(schema.dashboards.visibility, "org"),
                sql`exists (
                  select 1 from org_members as dashboard_member
                  where dashboard_member.org_id = ${schema.dashboards.orgId}
                    and lower(dashboard_member.email) = ${email.trim().toLowerCase()}
                    and dashboard_member.federation_removal_pending_at is null
                )`,
              ),
            ),
            inArray(schema.dashboards.id, [...new Set(resourceIds)]),
          ),
        );
      const memberOrgIds = new Set<string>();
      for (const row of rows) {
        if (!row.accessible && row.orgId) memberOrgIds.add(row.orgId);
      }
      const validatedOrgIds = new Set<string>();
      for (const orgId of memberOrgIds) {
        if (await isOrgMember(orgId, email)) validatedOrgIds.add(orgId);
      }
      const savedVersions = new Map(
        rows
          .filter(
            (row) =>
              row.hiddenBy !== BUILTIN_DASHBOARD_HIDDEN_BY &&
              (row.accessible ||
                (row.orgId !== null && validatedOrgIds.has(row.orgId))),
          )
          .map((row) => [row.id, row.updatedAt]),
      );
      const builtinIds = new Set(
        resourceIds
          .filter((id) => !savedVersions.has(id))
          .map(builtinDashboardIdFor)
          .filter((id) => id !== null),
      );
      const builtinVersions = new Map<string, string>();
      for (const builtinId of builtinIds) {
        const builtin = await loadBuiltinDashboard(builtinId, scope);
        if (builtin) builtinVersions.set(builtinId, builtin.version);
      }
      return resourceIds.flatMap((resourceId) => {
        const builtinId = builtinDashboardIdFor(resourceId);
        const sourceModifiedAt =
          savedVersions.get(resourceId) ??
          (builtinId ? builtinVersions.get(builtinId) : undefined);
        return sourceModifiedAt === undefined
          ? []
          : [{ resourceId, sourceModifiedAt }];
      });
    },
    async capture(reference) {
      const email = getRequestUserEmail();
      if (!email) throw new Error("no authenticated user");
      const orgId = getRequestOrgId() ?? null;
      const opened = await openDashboard(reference.resourceId, {
        email,
        orgId,
      });
      if (!opened) throw new Error("Dashboard not found");
      const dashboard = opened.saved ?? {
        id: reference.resourceId,
        kind: "sql" as const,
        title: opened.builtin.title,
        config: opened.builtin.config,
        updatedAt: opened.builtin.version,
        ownerEmail: email,
        orgId,
        visibility: "private" as const,
        canManage: false,
      };
      if (
        reference.expectedUpdatedAt &&
        reference.expectedUpdatedAt !== dashboard.updatedAt
      )
        throw new Error(
          "Dashboard changed before it could be submitted to Context.",
        );
      const payload = JSON.stringify({
        id: dashboard.id,
        kind: dashboard.kind,
        title: dashboard.title,
        config: dashboard.config,
        updatedAt: dashboard.updatedAt,
      });
      const contentHash = createHash("sha256").update(payload).digest("hex");
      const revisionId = `context-${Date.now()}-${contentHash.slice(0, 12)}`;
      await getDb()
        .insert(schema.dashboardRevisions)
        .values({
          id: revisionId,
          dashboardId: dashboard.id,
          kind: dashboard.kind,
          title: dashboard.title,
          config: JSON.stringify(dashboard.config),
          createdAt: new Date().toISOString(),
          createdBy: email,
          ownerEmail: dashboard.ownerEmail,
          orgId: dashboard.orgId,
        });
      const handle = await putPrivateBlob({
        data: Buffer.from(payload),
        filename: `${dashboard.id}.dashboard.json`,
        mimeType: "application/json",
        ownerEmail: dashboard.ownerEmail,
        key: `creative-context/analytics/${dashboard.id}/${contentHash}.json`,
        metadata: {
          appId: "analytics",
          resourceType: "dashboard",
          resourceId: dashboard.id,
          contentHash,
        },
      });
      if (!handle)
        throw new Error(
          "Private blob storage is required to submit a dashboard to Context.",
        );
      const preview = syntheticPreview(dashboard.config);
      return {
        artifactKey: `analytics:dashboard:${dashboard.id}`,
        source: {
          name: "Analytics",
          kind: "native-app",
          externalRef: dashboard.id,
          access: {
            visibility: dashboard.visibility,
            canManage: dashboard.canManage === true,
          },
        },
        items: [
          {
            externalId: `native:analytics:dashboard:${dashboard.id}`,
            kind: "dashboard",
            title: dashboard.title,
            canonicalUrl: `/adhoc/sql-dashboard/${dashboard.id}`,
            mimeType: "application/json",
            content: preview
              .map((panel) => `${panel.title} (${panel.visualization})`)
              .join("\n"),
            summary: `${preview.length} dashboard panels represented with synthetic preview data only.`,
            contentHash,
            sourceModifiedAt: dashboard.updatedAt,
            sourceVersion: revisionId,
            metadata: {
              preview: {
                type: "dashboard",
                data: "synthetic",
                panels: preview,
              },
            },
          },
        ],
        privateMetadata: {
          nativeResource: {
            appId: "analytics",
            resourceType: "dashboard",
            resourceId: dashboard.id,
            expectedUpdatedAt: reference.expectedUpdatedAt,
          },
          clone: {
            handle,
            appId: "analytics",
            resourceType: "dashboard",
            resourceId: dashboard.id,
            contentHash,
            sourceVersion: revisionId,
            updatedAt: dashboard.updatedAt,
          },
        },
      };
    },
  };
