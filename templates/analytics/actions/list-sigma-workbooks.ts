import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { getUserProfiles } from "@agent-native/core/user-profile/server";
import { isEmailDerivedName } from "@agent-native/core/user-profile/shared";
import { z } from "zod";

import {
  listExternalDashboards,
  type ExternalDashboardMigrationStatus,
} from "../server/lib/bi-migration/external-dashboards-store.js";
import { listSigmaWorkbooks } from "../server/lib/bi-migration/sigma-adapter.js";
import { resolveSigmaConnectionSelection } from "../server/lib/bi-migration/sigma-connections.js";
import {
  requireSigmaMigrationContext,
  sigmaMigrationSetupLink,
} from "../server/lib/bi-migration/sigma-migration.js";
import {
  loadAccessibleDashboardMetadataByIds,
  loadOrgDashboardOwnersByIds,
} from "../server/lib/dashboards-store.js";

// One Sigma page covers most orgs; mapping and dashboard reads take at most
// 100 ids each, so they run in chunks.
const WORKBOOK_PAGE_SIZE = 1_000;
const ID_CHUNK_SIZE = 100;

function chunk<T>(items: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += ID_CHUNK_SIZE) {
    chunks.push(items.slice(i, i + ID_CHUNK_SIZE));
  }
  return chunks;
}

const listSchema = z.object({
  connectionId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Selected connected Sigma workspace connection, when needed."),
  page: z
    .string()
    .trim()
    .min(1)
    .max(2_000)
    .optional()
    .describe("Opaque Sigma pagination cursor returned by the previous page."),
});

export default defineAction({
  description:
    "List Sigma workbooks accessible to the granted Analytics Sigma connection. Only workbooks the signed-in Sigma user can access are returned. Each workbook includes its migration status; a migrated workbook includes the Analytics dashboard id, link, and owner email and display name for every org member, plus canOpen and the dashboard title only when the caller can access that dashboard. Migrate an unmigrated workbook; open a migrated one instead of importing it again. Sigma workbook imports remain disabled until the source project mapping can be verified.",
  schema: listSchema,
  http: { method: "GET" },
  readOnly: true,
  mcpTool: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const context = await requireSigmaMigrationContext();
    const selection = await resolveSigmaConnectionSelection(args.connectionId);
    const connected = selection.connections.some(
      (connection) => connection.status === "connected",
    );
    const setupUrl = sigmaMigrationSetupLink("sigma");
    if (!selection.selected) {
      return {
        connected,
        connections: selection.connections,
        requiresConnectionSelection: selection.requiresSelection,
        setupUrl,
        workbooks: [],
        nextPage: null,
      };
    }

    const page = await listSigmaWorkbooks({
      connectionId: selection.selected.id,
      page: args.page,
      limit: WORKBOOK_PAGE_SIZE,
    });
    // Mapping rows are read only for workbooks Sigma returned to this user, so
    // nobody learns about a migration of a workbook they cannot see in Sigma.
    const migrations = (
      await Promise.all(
        chunk(page.workbooks.map((workbook) => workbook.workbookId)).map(
          (sourceIds) =>
            listExternalDashboards({
              provider: "sigma",
              sourceIds,
              limit: ID_CHUNK_SIZE,
            }),
        ),
      )
    ).flat();
    const migrationBySourceId = new Map(
      migrations.map((migration) => [migration.sourceId, migration]),
    );
    const dashboardIds = migrations.flatMap((migration) =>
      migration.status === "migrated" && migration.targetDashboardId
        ? [migration.targetDashboardId]
        : [],
    );
    const [dashboards, owners] = await Promise.all([
      Promise.all(
        chunk(dashboardIds).map((ids) =>
          loadAccessibleDashboardMetadataByIds(
            { email: context.userEmail, orgId: context.orgId },
            ids,
          ),
        ),
      ).then((results) => results.flat()),
      Promise.all(
        chunk(dashboardIds).map((ids) =>
          loadOrgDashboardOwnersByIds(context.orgId, ids),
        ),
      ).then((results) => results.flat()),
    ]);
    const dashboardById = new Map(
      dashboards.map((dashboard) => [dashboard.id, dashboard]),
    );
    const ownerById = new Map(
      owners
        .filter((owner) => owner.kind === "sql")
        .map((owner) => [owner.id, owner]),
    );

    const ownerEmailOf = (sourceId: string): string | null => {
      const migration = migrationBySourceId.get(sourceId);
      if (migration?.status === "migrated") {
        const owner = migration.targetDashboardId
          ? ownerById.get(migration.targetDashboardId)
          : undefined;
        return owner?.ownerEmail.toLowerCase() ?? migration.migratedByEmail;
      }
      return migration?.status === "migrating"
        ? migration.migratedByEmail
        : null;
    };
    // Names for the owner avatars, in one batch so the table never looks
    // people up row by row.
    const profiles = await getUserProfiles(
      page.workbooks.flatMap((workbook) => {
        const email = ownerEmailOf(workbook.workbookId);
        return email ? [email] : [];
      }),
    );
    const displayNameOf = (email: string): string | null => {
      const name = profiles.get(email.toLowerCase())?.name?.trim();
      return name && !isEmailDerivedName(name, email) ? name : null;
    };

    const workbooks = page.workbooks.map((workbook) => {
      const migration = migrationBySourceId.get(workbook.workbookId);
      const status: ExternalDashboardMigrationStatus =
        migration?.status ?? "not_started";
      const targetDashboardId =
        migration?.status === "migrated"
          ? (migration.targetDashboardId ?? undefined)
          : undefined;
      const owner = targetDashboardId
        ? ownerById.get(targetDashboardId)
        : undefined;
      const accessible = targetDashboardId
        ? dashboardById.get(targetDashboardId)
        : undefined;
      const canOpen = Boolean(
        owner &&
        accessible?.kind === "sql" &&
        accessible.orgId === context.orgId,
      );
      const dashboardId = owner ? owner.id : undefined;
      const migratedOwnerEmail =
        migration?.status === "migrated"
          ? ownerEmailOf(workbook.workbookId)
          : null;
      const migratingByEmail =
        migration?.status === "migrating"
          ? ownerEmailOf(workbook.workbookId)
          : null;
      return {
        id: workbook.workbookId,
        name: workbook.name,
        ...(typeof workbook.isArchived === "boolean"
          ? { isArchived: workbook.isArchived }
          : {}),
        ...(workbook.path ? { path: workbook.path } : {}),
        ...(workbook.updatedAt ? { updatedAt: workbook.updatedAt } : {}),
        status,
        ...(dashboardId
          ? {
              dashboardId,
              ...(canOpen && accessible
                ? { dashboardName: accessible.title }
                : {}),
              dashboardUrl: buildDeepLink({
                app: "analytics",
                view: "adhoc",
                params: { dashboardId },
              }),
              canOpen,
            }
          : {}),
        ...(migratedOwnerEmail
          ? {
              migratedOwnerEmail,
              migratedOwnerName: displayNameOf(migratedOwnerEmail),
            }
          : {}),
        ...(migration?.status === "migrated" &&
        migration.migratedByCurrentUser &&
        targetDashboardId &&
        !owner
          ? { canRecoverMissingDashboard: true }
          : {}),
        ...(migratingByEmail
          ? {
              migratingByEmail,
              migratingByName: displayNameOf(migratingByEmail),
            }
          : {}),
        canStartImport: migration?.canStartImport ?? true,
        ...(migration?.status === "migrating" && migration.canRetryStaleClaim
          ? { canRetryStaleClaim: true }
          : {}),
        ...(migration?.flaggedCount
          ? { flaggedCount: migration.flaggedCount }
          : {}),
        ...(migration?.status === "migrated" && !migration.migratedByCurrentUser
          ? { migratedByTeammate: true }
          : {}),
      };
    });

    return {
      connected,
      connectionId: selection.selected.id,
      connectionLabel: selection.selected.label,
      connections: selection.connections,
      requiresConnectionSelection: false,
      setupUrl,
      workbooks,
      nextPage: page.nextPage,
      ...(page.total !== undefined ? { total: page.total } : {}),
    };
  },
});
