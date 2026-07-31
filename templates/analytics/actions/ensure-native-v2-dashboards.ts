import { createHash } from "node:crypto";

import { defineAction, embedApp } from "@agent-native/core";
import { getDataProgram } from "@agent-native/core/data-programs";
import {
  buildDeepLink,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import setResourceVisibilityAction from "@agent-native/core/sharing/actions/set-resource-visibility";
import { z } from "zod";

import { getDashboard, upsertDashboard } from "../server/lib/dashboards-store";
import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections";
import {
  compileNativeV2Dashboard,
  getNativeV2DashboardManifest,
  nativeV2DashboardManifests,
  NATIVE_V2_DASHBOARD_IDS,
  type NativeV2Binding,
  type NativeV2BindingKey,
  type NativeV2DashboardId,
} from "../server/lib/native-v2-dashboards";

const ANALYTICS_APP_ID = "analytics";

const bindingSchema = z.object({
  programId: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

function orgDashboardId(
  orgId: string,
  templateId: NativeV2DashboardId,
): string {
  const suffix = createHash("sha256").update(orgId).digest("hex").slice(0, 10);
  return `native-${templateId}-${suffix}`;
}

function parseOutputColumns(value: string | null): Set<string> {
  if (!value) return new Set();
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.flatMap((column) =>
        column && typeof column === "object" && typeof column.name === "string"
          ? [column.name]
          : [],
      ),
    );
  } catch {
    return new Set();
  }
}

function templateIdFromDashboard(
  config: Record<string, unknown>,
): string | null {
  const catalog = config.catalog;
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    return null;
  }
  const templateId = (catalog as Record<string, unknown>).templateId;
  return typeof templateId === "string" ? templateId : null;
}

async function validateAndShareBindings(
  bindings: Record<string, NativeV2Binding>,
  requiredKeys: NativeV2BindingKey[],
  requiredColumnsByBinding: Partial<Record<NativeV2BindingKey, string[]>>,
  admin: { userEmail: string; orgId: string },
): Promise<void> {
  const missing = requiredKeys.filter((key) => !bindings[key]?.programId);
  if (missing.length > 0) {
    throw new Error(`Missing required v2 bindings: ${missing.join(", ")}`);
  }

  const uniqueProgramIds = new Set(
    requiredKeys.map((key) => bindings[key]?.programId).filter(Boolean),
  );
  const programsToShare: string[] = [];
  for (const programId of uniqueProgramIds) {
    const program = await getDataProgram(programId, ANALYTICS_APP_ID);
    if (!program) {
      throw new Error(`Data program not found: ${programId}`);
    }
    if (program.orgId && program.orgId !== admin.orgId) {
      throw new Error(
        `Data program belongs to another organization: ${programId}`,
      );
    }
    if (program.archivedAt) {
      throw new Error(`Data program is archived: ${programId}`);
    }
    const access = await resolveAccess("data_program", programId, {
      userEmail: admin.userEmail,
      orgId: admin.orgId,
    });
    if (!access) {
      throw new Error(`No access to data program: ${programId}`);
    }
    const outputColumns = parseOutputColumns(program.outputColumns);
    const missingColumns = [
      ...new Set(
        requiredKeys.flatMap((key) =>
          bindings[key]?.programId === programId
            ? (requiredColumnsByBinding[key] ?? [])
            : [],
        ),
      ),
    ].filter((column) => !outputColumns.has(column));
    if (missingColumns.length > 0) {
      throw new Error(
        `Data program ${programId} is missing required output columns: ${missingColumns.join(", ")}. Re-save it after a successful dry-run.`,
      );
    }

    if (program.visibility !== "org" || program.orgId !== admin.orgId) {
      programsToShare.push(programId);
    }
  }

  for (const programId of programsToShare) {
    await setResourceVisibilityAction.run({
      resourceType: "data_program",
      resourceId: programId,
      visibility: "org",
    });
  }
}

export interface EnsureNativeV2DashboardsResult {
  orgId: string;
  dashboards: Array<{
    templateId: NativeV2DashboardId;
    dashboardId: string;
    status: "created" | "updated" | "preserved";
    requiredBindings: NativeV2BindingKey[];
  }>;
}

export async function ensureNativeV2Dashboards(
  args: {
    templateIds?: NativeV2DashboardId[];
    bindings: Record<string, NativeV2Binding>;
    overwrite: boolean;
  },
  ctx?: { userEmail?: string; orgId?: string | null },
): Promise<EnsureNativeV2DashboardsResult> {
  const admin = await requireAnalyticsAdminContext(ctx);
  const templateIds = args.templateIds?.length
    ? args.templateIds
    : [...NATIVE_V2_DASHBOARD_IDS];
  const manifests = templateIds.map(getNativeV2DashboardManifest);
  const allRequiredBindings = [
    ...new Set(manifests.flatMap((manifest) => manifest.requiredBindings)),
  ];
  const requiredColumnsByBinding: Partial<
    Record<NativeV2BindingKey, string[]>
  > = Object.fromEntries(
    manifests.flatMap((manifest) =>
      manifest.panels
        .filter(
          (panel): panel is typeof panel & { bindingKey: NativeV2BindingKey } =>
            Boolean(panel.bindingKey),
        )
        .map((panel) => [panel.bindingKey, panel.requiredColumns ?? []]),
    ),
  );

  await validateAndShareBindings(
    args.bindings,
    allRequiredBindings,
    requiredColumnsByBinding,
    admin,
  );

  const installedAt = new Date().toISOString();
  const dashboards: EnsureNativeV2DashboardsResult["dashboards"] = [];
  for (const manifest of manifests) {
    const dashboardId = orgDashboardId(admin.orgId, manifest.id);
    const existing = await getDashboard(dashboardId, {
      email: admin.userEmail,
      orgId: admin.orgId,
    });
    if (existing && templateIdFromDashboard(existing.config) !== manifest.id) {
      throw new Error(
        `Refusing to overwrite unrelated dashboard at deterministic id ${dashboardId}.`,
      );
    }

    if (existing && !args.overwrite) {
      dashboards.push({
        templateId: manifest.id,
        dashboardId,
        status: "preserved",
        requiredBindings: manifest.requiredBindings,
      });
      continue;
    }

    const config = compileNativeV2Dashboard(
      manifest,
      args.bindings,
      installedAt,
    );
    await upsertDashboard(
      dashboardId,
      "sql",
      config as unknown as Record<string, unknown>,
      {
        email: admin.userEmail,
        orgId: admin.orgId,
      },
    );
    if (!existing) {
      await setResourceVisibilityAction.run({
        resourceType: "dashboard",
        resourceId: dashboardId,
        visibility: "org",
      });
    }
    dashboards.push({
      templateId: manifest.id,
      dashboardId,
      status: existing ? "updated" : "created",
      requiredBindings: manifest.requiredBindings,
    });
  }

  return { orgId: admin.orgId, dashboards };
}

export default defineAction({
  description:
    "Provision the four reusable native Analytics v2 dashboard patterns for the active organization from explicit Data Program bindings. " +
    "This is an admin-only post-deploy action: it validates every program exists and exposes the manifest's required output columns, shares the bound programs with the organization, creates deterministic native-* dashboard copies, and never changes the legacy extension dashboards. " +
    "Re-running preserves existing v2 dashboard edits unless overwrite=true.",
  schema: z.object({
    templateIds: z
      .array(z.enum(NATIVE_V2_DASHBOARD_IDS))
      .min(1)
      .optional()
      .describe("Optional subset of native v2 templates to provision."),
    bindings: z
      .record(z.string(), bindingSchema)
      .describe(
        'Binding key to stored Analytics Data Program, e.g. {"roi.kpi": {"programId": "dp_..."}}.',
      ),
    overwrite: z
      .boolean()
      .optional()
      .default(false)
      .describe("Replace an existing v2 copy only when explicitly true."),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Native Analytics v2 dashboards",
      description: "Open the provisioned native v2 dashboard in Analytics.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open native v2 dashboard",
      height: 680,
    }),
  },
  run: async (args, ctx) => {
    const userEmail = ctx?.userEmail ?? getRequestUserEmail();
    const orgId = ctx?.orgId ?? getRequestOrgId() ?? null;
    return ensureNativeV2Dashboards(
      {
        templateIds: args.templateIds,
        bindings: args.bindings,
        overwrite: args.overwrite,
      },
      { userEmail, orgId },
    );
  },
  link: ({ result }) => {
    const dashboardId =
      result && typeof result === "object"
        ? (result as EnsureNativeV2DashboardsResult).dashboards?.[0]
            ?.dashboardId
        : null;
    if (!dashboardId) return null;
    return {
      url: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId },
      }),
      label: "Open native v2 dashboard",
      view: "adhoc",
    };
  },
});

export { nativeV2DashboardManifests };
