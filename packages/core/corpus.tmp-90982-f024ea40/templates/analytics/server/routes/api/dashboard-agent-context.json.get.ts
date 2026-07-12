import {
  AGENT_ACCESS_PARAM,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { ANALYTICS_DASHBOARD_AGENT_RESOURCE_KIND } from "../../../shared/resource-agent-access.js";
import { getDb, schema } from "../../db/index.js";
import {
  buildDashboardAgentContext,
  buildDashboardSeedAgentContext,
} from "../../lib/agent-readable-resource-context.js";
import { loadDashboardSeed } from "../../lib/dashboard-seeds.js";
import type { DashboardRecord } from "../../lib/dashboards-store.js";

function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function rowToDashboard(row: any): DashboardRecord {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    config: parseJsonObject(row.config),
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy ?? null,
    archivedAt: row.archivedAt ?? null,
    hiddenAt: row.hiddenAt ?? null,
    hiddenBy: row.hiddenBy ?? null,
  };
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");

  const query = getQuery(event);
  const id = queryString(query.id);
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Dashboard id is required" };
  }

  const token = queryString(query[AGENT_ACCESS_PARAM]);
  const tokenAccess = token
    ? verifyScopedAgentAccessToken(token, {
        resourceKind: ANALYTICS_DASHBOARD_AGENT_RESOURCE_KIND,
        resourceId: id,
      }).ok
    : false;
  const db = getDb() as any;
  // guard:allow-unscoped -- this endpoint returns dashboard context only when the dashboard is public or a dashboard-scoped agent_access token verifies for this id.
  const [row] = await db
    .select()
    .from(schema.dashboards)
    .where(eq(schema.dashboards.id, id))
    .limit(1);

  const seed = row ? null : loadDashboardSeed(id);
  if (!row && seed) {
    if (!tokenAccess) {
      setResponseStatus(event, 403);
      return { error: "Invalid or expired agent access token" };
    }
    return buildDashboardSeedAgentContext(id, seed, { includeConfig: true });
  }

  if (!row) {
    setResponseStatus(event, 404);
    return { error: "Dashboard not found" };
  }

  if (row.visibility !== "public" && !tokenAccess) {
    setResponseStatus(event, 403);
    return { error: "Invalid or expired agent access token" };
  }

  return buildDashboardAgentContext(rowToDashboard(row), {
    includeConfig: true,
  });
});
