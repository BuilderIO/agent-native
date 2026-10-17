import { callAction } from "@agent-native/core/client/hooks";

import { DASHBOARD_REPORT_BOOTSTRAP_TIMEOUT_MS } from "@/lib/dashboard-report-capture";
import type { ResourceAccess } from "@/lib/resource-access";

import type { DashboardCertification, SqlDashboardConfig } from "./types";

export type FetchedDashboard = {
  id: string;
  config: SqlDashboardConfig;
  archivedAt: string | null;
  hiddenAt: string | null;
  hiddenBy: string | null;
  orgId: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string | null;
  createdBy: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
} & ResourceAccess;

function parseDashboardDemoMetadata(
  value: unknown,
): SqlDashboardConfig["demo"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  return typeof raw.id === "string" && raw.id
    ? {
        id: raw.id,
        version: typeof raw.version === "string" ? raw.version : undefined,
        installedAt:
          typeof raw.installedAt === "string" ? raw.installedAt : undefined,
      }
    : undefined;
}

function parseDashboardCatalogMetadata(
  value: unknown,
): SqlDashboardConfig["catalog"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  return {
    templateId: typeof raw.templateId === "string" ? raw.templateId : undefined,
    templateVersion:
      typeof raw.templateVersion === "string" ? raw.templateVersion : undefined,
    installedAt:
      typeof raw.installedAt === "string" ? raw.installedAt : undefined,
  };
}

export function parseDashboardCertification(
  value: unknown,
): DashboardCertification | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.status !== "certified" ||
    typeof raw.certifiedAt !== "string" ||
    typeof raw.certifiedBy !== "string" ||
    typeof raw.certifiedForUpdatedAt !== "string"
  ) {
    return undefined;
  }
  return {
    status: "certified",
    certifiedAt: raw.certifiedAt,
    certifiedBy: raw.certifiedBy,
    certifiedForUpdatedAt: raw.certifiedForUpdatedAt,
  };
}

export async function fetchDashboard(
  id: string,
  options?: { reportScreenshot?: boolean },
): Promise<FetchedDashboard | null> {
  try {
    const data: any = await callAction(
      "get-sql-dashboard",
      { id, includeConfig: true },
      {
        method: "GET",
        ...(options?.reportScreenshot
          ? { timeoutMs: DASHBOARD_REPORT_BOOTSTRAP_TIMEOUT_MS }
          : {}),
      },
    );
    if (!data) return null;
    if (data.error) {
      throw new Error(
        typeof data.message === "string" && data.message
          ? data.message
          : typeof data.error === "string"
            ? data.error
            : "Dashboard bootstrap failed",
      );
    }
    return {
      id,
      config: {
        name: data.name ?? "Untitled Dashboard",
        description: data.description,
        certification: parseDashboardCertification(data.certification),
        parentId:
          typeof data.parentId === "string" && data.parentId.trim().length > 0
            ? data.parentId
            : undefined,
        catalog: parseDashboardCatalogMetadata(data.catalog),
        demo: parseDashboardDemoMetadata(data.demo),
        filters: data.filters,
        variables: data.variables,
        columns: typeof data.columns === "number" ? data.columns : undefined,
        panels: data.panels ?? [],
        annotations: data.annotations,
        introducedPanels: data.introducedPanels,
      },
      archivedAt: typeof data.archivedAt === "string" ? data.archivedAt : null,
      hiddenAt: typeof data.hiddenAt === "string" ? data.hiddenAt : null,
      hiddenBy: typeof data.hiddenBy === "string" ? data.hiddenBy : null,
      orgId: typeof data.orgId === "string" ? data.orgId : null,
      visibility:
        data.visibility === "org" || data.visibility === "public"
          ? data.visibility
          : "private",
      createdAt: typeof data.createdAt === "string" ? data.createdAt : null,
      createdBy: typeof data.createdBy === "string" ? data.createdBy : null,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
      updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
      role: typeof data.role === "string" ? data.role : undefined,
      canEdit: typeof data.canEdit === "boolean" ? data.canEdit : undefined,
      canManage:
        typeof data.canManage === "boolean" ? data.canManage : undefined,
    };
  } catch (error) {
    if (options?.reportScreenshot) throw error;
    return null;
  }
}
