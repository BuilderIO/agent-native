import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { and, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireDbAdminContextFromRequest } from "../server/lib/db-admin-connections";

type DashboardUsageStats = {
  id: string;
  name: string;
  kind: "explorer" | "sql";
  ownerEmail: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  archivedAt: string | null;
  hiddenAt: string | null;
  hiddenBy: string | null;
  viewCount: number;
  engagementCount: number;
  eventEngagementCount: number;
  savedViewCount: number;
  uniqueUserCount: number;
  lastViewedAt: string | null;
  lastSavedViewAt: string | null;
  panelCount: number | null;
  url: string;
};

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseConfig(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function dashboardName(row: { title: string; config: unknown }): string {
  const config = parseConfig(row.config);
  const configName = config.name;
  if (typeof configName === "string" && configName.trim()) {
    return configName.trim();
  }
  return row.title || "Untitled";
}

function dashboardPanelCount(row: {
  kind: string;
  config: unknown;
}): number | null {
  if (row.kind !== "sql") return null;
  const panels = parseConfig(row.config).panels;
  return Array.isArray(panels) ? panels.length : 0;
}

export function dashboardIdFromPath(path: string | null): string | null {
  const pathname = path ?? "";
  const match = pathname.match(/(?:^|\/)(?:dashboards|adhoc)\/([^/?#]+)/);
  if (!match) return null;
  if (match[1] === "explorer-dashboard") {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function dashboardIdFromEventLocation(
  path: string | null,
  url: string | null,
): string | null {
  const direct = dashboardIdFromPath(path);
  if (direct) return direct;
  const raw = url || path;
  if (!raw) return null;
  try {
    const parsed = new URL(raw, "https://analytics.local");
    if (
      /(?:^|\/)(?:dashboards|adhoc)\/explorer-dashboard$/.test(parsed.pathname)
    ) {
      const id = parsed.searchParams.get("id");
      return id && id.trim() ? id : null;
    }
  } catch {
    // Fall through to regex below for malformed relative strings.
  }
  const match = raw.match(
    /(?:^|\/)(?:dashboards|adhoc)\/explorer-dashboard(?:\?[^#]*)?[?&]id=([^&#]+)/,
  );
  if (!match) return null;
  try {
    return decodeURIComponent(match[1].replace(/\+/g, " "));
  } catch {
    return match[1];
  }
}

function dashboardUrl(row: { id: string; kind: string }): string {
  return row.kind === "explorer"
    ? `/dashboards/explorer-dashboard?id=${encodeURIComponent(row.id)}`
    : `/dashboards/${encodeURIComponent(row.id)}`;
}

export default defineAction({
  description:
    "List admin-only dashboard usage and cleanup stats for every dashboard in the active organization. Includes lifecycle metadata, owner, last tracked modifier, pageviews, engagement events, unique viewers, saved view counts, archive/hidden state, and dashboard links. Requires active organization owner/admin role.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  link: () => ({
    url: buildDeepLink({
      app: "analytics",
      view: "agents",
      params: { agentsView: "dashboards" },
    }),
    label: "Open dashboard usage admin",
    view: "agents",
  }),
  run: async (_args, ctx) => {
    const admin = await requireDbAdminContextFromRequest(ctx);
    const db = getDb() as any;

    // guard:allow-unscoped — org owner/admin audit intentionally spans all
    // dashboard rows in the active org after requireDbAdminContextFromRequest.
    const dashboardRows = await db
      .select()
      .from(schema.dashboards)
      .where(eq(schema.dashboards.orgId, admin.orgId));

    const dashboardIds = new Set<string>(
      dashboardRows.map((row: { id: string }) => row.id),
    );

    const savedViewRows = await db
      .select({
        dashboardId: schema.dashboardViews.dashboardId,
        count: sql<number>`count(*)`,
        lastSavedViewAt: sql<
          string | null
        >`max(${schema.dashboardViews.createdAt})`,
      })
      .from(schema.dashboardViews)
      .groupBy(schema.dashboardViews.dashboardId);

    const savedViewsByDashboard = new Map<
      string,
      { count: number; lastSavedViewAt: string | null }
    >();
    for (const row of savedViewRows as Array<{
      dashboardId: string;
      count: unknown;
      lastSavedViewAt: string | null;
    }>) {
      if (!dashboardIds.has(row.dashboardId)) continue;
      savedViewsByDashboard.set(row.dashboardId, {
        count: toNumber(row.count),
        lastSavedViewAt: row.lastSavedViewAt ?? null,
      });
    }

    const analyticsUserIdentity = sql<
      string | null
    >`coalesce(nullif(${schema.analyticsEvents.userKey}, ''), nullif(${schema.analyticsEvents.userId}, ''), nullif(${schema.analyticsEvents.anonymousId}, ''), nullif(${schema.analyticsEvents.sessionId}, ''))`;
    const eventRows = await db
      .select({
        path: schema.analyticsEvents.path,
        url: schema.analyticsEvents.url,
        eventName: schema.analyticsEvents.eventName,
        count: sql<number>`count(*)`,
        userIdentity: analyticsUserIdentity,
        lastSeenAt: sql<
          string | null
        >`max(${schema.analyticsEvents.receivedAt})`,
      })
      .from(schema.analyticsEvents)
      .where(
        and(
          eq(schema.analyticsEvents.orgId, admin.orgId),
          or(
            like(schema.analyticsEvents.path, "%/dashboards/%"),
            like(schema.analyticsEvents.path, "%/adhoc/%"),
            like(schema.analyticsEvents.url, "%/dashboards/%"),
            like(schema.analyticsEvents.url, "%/adhoc/%"),
          ),
        ),
      )
      .groupBy(
        schema.analyticsEvents.path,
        schema.analyticsEvents.url,
        schema.analyticsEvents.eventName,
        analyticsUserIdentity,
      );

    const eventsByDashboard = new Map<
      string,
      {
        viewCount: number;
        eventEngagementCount: number;
        uniqueUsers: Set<string>;
        lastViewedAt: string | null;
      }
    >();
    for (const row of eventRows as Array<{
      path: string | null;
      url: string | null;
      eventName: string;
      count: unknown;
      userIdentity: string | null;
      lastSeenAt: string | null;
    }>) {
      const dashboardId = dashboardIdFromEventLocation(row.path, row.url);
      if (!dashboardId || !dashboardIds.has(dashboardId)) continue;
      const current = eventsByDashboard.get(dashboardId) ?? {
        viewCount: 0,
        eventEngagementCount: 0,
        uniqueUsers: new Set<string>(),
        lastViewedAt: null,
      };
      const count = toNumber(row.count);
      if (row.eventName === "pageview") {
        current.viewCount += count;
        current.lastViewedAt =
          !current.lastViewedAt ||
          (row.lastSeenAt && row.lastSeenAt > current.lastViewedAt)
            ? (row.lastSeenAt ?? current.lastViewedAt)
            : current.lastViewedAt;
      } else {
        current.eventEngagementCount += count;
      }
      if (row.userIdentity) current.uniqueUsers.add(row.userIdentity);
      eventsByDashboard.set(dashboardId, current);
    }

    return (dashboardRows as Array<any>)
      .map((row): DashboardUsageStats => {
        const savedViews = savedViewsByDashboard.get(row.id) ?? {
          count: 0,
          lastSavedViewAt: null,
        };
        const events = eventsByDashboard.get(row.id) ?? {
          viewCount: 0,
          eventEngagementCount: 0,
          uniqueUsers: new Set<string>(),
          lastViewedAt: null,
        };
        return {
          id: row.id,
          name: dashboardName(row),
          kind: row.kind === "explorer" ? "explorer" : "sql",
          ownerEmail: row.ownerEmail ?? null,
          visibility:
            row.visibility === "org" || row.visibility === "public"
              ? row.visibility
              : "private",
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          updatedBy: row.updatedBy ?? null,
          archivedAt: row.archivedAt ?? null,
          hiddenAt: row.hiddenAt ?? null,
          hiddenBy: row.hiddenBy ?? null,
          viewCount: events.viewCount,
          eventEngagementCount: events.eventEngagementCount,
          savedViewCount: savedViews.count,
          engagementCount: events.eventEngagementCount + savedViews.count,
          uniqueUserCount: events.uniqueUsers.size,
          lastViewedAt: events.lastViewedAt,
          lastSavedViewAt: savedViews.lastSavedViewAt,
          panelCount: dashboardPanelCount(row),
          url: dashboardUrl(row),
        };
      })
      .sort((a, b) => {
        const views = b.viewCount - a.viewCount;
        if (views !== 0) return views;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  },
});
