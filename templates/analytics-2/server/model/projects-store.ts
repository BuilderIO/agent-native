import { createHash } from "node:crypto";

import { fail } from "@agent-native/core/action";
import {
  alias,
  and,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from "@agent-native/core/db/schema";
import { accessFilter } from "@agent-native/core/sharing";
import { isNotNull } from "drizzle-orm";

import type {
  Cell,
  CellDraft,
  Project,
  ProjectDocument,
  ProjectLanguage,
  ProjectListRow,
} from "../../app/lib/model/contracts.js";
import {
  UNTITLED_PROJECT_NAME,
  normalizeProjectTitle,
  projectSchema,
} from "../../app/lib/model/contracts.js";
import { withoutPendingCellEdit } from "../../app/lib/model/contracts.js";
import {
  projectVersionSchema,
  type ProjectVersion,
} from "../../app/lib/model/project-version-contracts.js";
import {
  appDocumentSchema,
  draftAppLayout,
  pruneAppLayout,
} from "../../shared/app-layout.js";
import { cellSearchText } from "../../shared/cell-search-text.js";
import type {
  RestoreProjectVersionInput,
  SaveProjectVersionInput,
} from "../../shared/notebook-history.js";
import type { NotebookSnapshot } from "../../shared/notebook-operations.js";
import {
  type DraftHead,
  draftHeadSchema,
  notebookCellIdSchema,
  revisionSchema,
} from "../../shared/notebook-snapshot-contract.js";
import { foldText } from "../../shared/text-fold.js";
import { getDb, schema } from "../db/index.js";
import { readAppDocument, writeAppDocument } from "./app-layouts.js";
import { readCells, readReadableCells } from "./cells-store.js";
import { nowIso } from "./clock.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { sweepDataframeBlobs } from "./dataframe-lifecycle.js";
import { newId } from "./ids.js";
import { StoredDataError } from "./json-column.js";
import { lockNotebookRunOutputs } from "./notebook-execution/run-store.js";
import { draftNamespace } from "./notebook-execution/snapshot.js";
import {
  applyLegacyNotebookOperation,
  readLegacyNotebook,
  requireAppliedNotebookOperation,
  type LegacyNotebook,
} from "./notebook-operations/legacy.js";
import { adoptNotebook } from "./notebook-operations/migration.js";
import {
  installNotebookLineage,
  lockNotebookProject,
  readNotebookCells,
  readNotebookDraft,
  readNotebookVersionOperation,
  recordNotebookCheckpoint,
  snapshotRef,
  writeNotebookVersionCells,
} from "./notebook-operations/store.js";
import {
  assertAuthorizedProject,
  assertEditableProject,
  getAuthorizedProjectRow,
  getReadableProjectRow,
  ProjectAccessError,
  type ProjectRow,
} from "./project-access.js";
import {
  purgeProjectFiles,
  withProjectFileGuard,
} from "./project-file-cleanup.js";
import {
  canEditProject,
  projectAccessLevel,
  resolveProjectAccess,
  type ProjectAccessLevel,
  type ProjectGrant,
} from "./project-grant-access.js";
import { lockCellOutputForEdit } from "./runs-store.js";
import {
  type Queryable,
  type WorkspaceScope,
  requireWorkspaceScope,
} from "./scope.js";

const { projects, projectVersions, projectCollections } = schema;

export type ProjectScope = WorkspaceScope;

export type ProjectCursor = { updatedAt: string; id: string };

export type ListProjectsFilter = ProjectScope & {
  /** Read the trash instead of the live workspace. */
  trashed?: boolean;
  collectionId?: string;
  statusId?: string;
  favorited?: boolean;
  /** Case-insensitive substring of the title or description. */
  search?: string;
  /**
   * Page size. Omit it for a complete browser listing: the UI does not inherit
   * the agent's narrow recent limit. Callers that only need the recents strip
   * pass a small limit and keep it.
   */
  limit?: number;
  /** Keyset cursor from the previous page, ordered by (updatedAt, id). */
  cursor?: ProjectCursor;
};

export type ProjectPage = {
  items: Project[];
  nextCursor: ProjectCursor | null;
  hasMore: boolean;
};

function toProject(row: ProjectRow): Project {
  return projectSchema.parse({
    id: row.id,
    ownerEmail: row.ownerEmail,
    title: row.title,
    ...(row.untitledOrdinal == null
      ? {}
      : { untitledOrdinal: row.untitledOrdinal }),
    description: row.description,
    language: row.language,
    statusId: row.statusId ?? null,
    favorited: row.favorited,
    allowEmbedding: row.allowEmbedding,
    trashedAt: row.trashedAt ?? null,
    archivedAt: row.archivedAt ?? null,
    lastOpenedAt: row.lastOpenedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function requirePageLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("Project page size must be a positive integer.");
  }
  return limit;
}

function projectConditions(
  scope: WorkspaceScope,
  filter: ListProjectsFilter,
): ReturnType<typeof eq>[] {
  const trashed = filter.trashed === true;
  const conditions: ReturnType<typeof eq>[] = [
    filter.collectionId !== undefined && !trashed
      ? accessFilter(projects, schema.projectShares, {
          userEmail: scope.ownerEmail,
          orgId: scope.orgId,
        })
      : eq(projects.ownerEmail, scope.ownerEmail),
    eq(projects.orgId, scope.orgId),
    eq(projects.listed, true),
    trashed
      ? sql`${projects.trashedAt} is not null`
      : isNull(projects.trashedAt),
  ];
  if (filter.statusId !== undefined) {
    conditions.push(eq(projects.statusId, filter.statusId));
  }
  if (filter.favorited === true) {
    conditions.push(eq(projects.favorited, true));
  }
  if (filter.search !== undefined && filter.search.trim() !== "") {
    const needle = filter.search.trim().toLowerCase();
    conditions.push(
      sql`(strpos(lower(${projects.title}), ${needle}) > 0
        OR strpos(lower(${projects.description}), ${needle}) > 0)`,
    );
  }
  if (filter.collectionId !== undefined) {
    conditions.push(
      sql`exists (select 1 from ${projectCollections}
        where ${projectCollections.projectId} = ${projects.id}
          and ${projectCollections.collectionId} = ${filter.collectionId})`,
    );
  }
  if (filter.cursor !== undefined) {
    conditions.push(
      sql`(${projects.updatedAt} < ${filter.cursor.updatedAt}
        OR (${projects.updatedAt} = ${filter.cursor.updatedAt}
          AND ${projects.id} < ${filter.cursor.id}))`,
    );
  }
  return conditions;
}

/**
 * One page of the browser listing. Search, trash, favourite, status and
 * collection filters are applied in SQL before the page is cut, and the
 * `(updatedAt, id)` keyset keeps the order stable while rows change.
 */
export async function listProjectsPage(
  filter: ListProjectsFilter,
): Promise<ProjectPage> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(filter);
  const limit = requirePageLimit(filter.limit);
  const conditions = projectConditions(scope, filter);

  const query = getDb()
    .select()
    .from(projects)
    .where(and(...conditions))
    .orderBy(desc(projects.updatedAt), desc(projects.id));
  const rows = limit === undefined ? await query : await query.limit(limit + 1);

  const hasMore = limit !== undefined && rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(toProject),
    nextCursor:
      hasMore && last !== undefined
        ? { updatedAt: last.updatedAt, id: last.id }
        : null,
    hasMore,
  };
}

/**
 * The complete list by default; passing `limit` keeps a narrow recent list.
 * Both forms are scoped to the request's account and organisation.
 */
export async function listProjects(
  filter: ListProjectsFilter,
): Promise<Project[]> {
  return (await listProjectsPage(filter)).items;
}

export async function listProjectRows(
  filter: Omit<ListProjectsFilter, "limit" | "cursor"> & { archived: boolean },
): Promise<ProjectListRow[]> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(filter);
  const { projectShares, projectViews } = schema;
  const db = getDb();
  const initialVersion = alias(projectVersions, "initial_version");
  const nowMs = Date.now();
  const sevenDaysAgo = new Date(nowMs - 7 * 86_400_000).toISOString();
  const fourteenDaysAgo = new Date(nowMs - 14 * 86_400_000).toISOString();
  const thirtyDaysAgo = new Date(nowMs - 30 * 86_400_000).toISOString();
  const appVisits = db
    .select({
      count: sql<number>`count(*)::int`.as("visit_count"),
      count7d:
        sql<number>`count(*) filter (where ${projectViews.viewedAt} >= ${sevenDaysAgo})::int`.as(
          "visit_count_7d",
        ),
      count14d:
        sql<number>`count(*) filter (where ${projectViews.viewedAt} >= ${fourteenDaysAgo})::int`.as(
          "visit_count_14d",
        ),
      count30d:
        sql<number>`count(*) filter (where ${projectViews.viewedAt} >= ${thirtyDaysAgo})::int`.as(
          "visit_count_30d",
        ),
      lastViewedAt: sql<string | null>`max(${projectViews.viewedAt})
        filter (where ${projectViews.viewerEmail} = ${scope.ownerEmail.toLowerCase()})`.as(
        "last_viewed_at",
      ),
    })
    .from(projectViews)
    .where(
      and(
        eq(projectViews.projectId, projects.id),
        eq(projectViews.orgId, scope.orgId),
        eq(projectViews.viewKind, "app"),
      ),
    )
    .as("app_visits");
  const shares = db
    .select({
      directCount: sql<number>`count(*) filter (where ${or(
        and(
          eq(projectShares.principalType, "user"),
          sql`lower(${projectShares.principalId}) <> ${scope.ownerEmail.toLowerCase()}`,
        ),
        eq(projectShares.principalType, "group"),
      )})::int`.as("direct_count"),
      workspace: sql<boolean>`count(*) filter (where ${and(
        eq(projectShares.principalType, "org"),
        eq(projectShares.principalId, scope.orgId),
      )}) > 0`.as("workspace_shared"),
    })
    .from(projectShares)
    .where(eq(projectShares.resourceId, projects.id))
    .as("sharing");
  const { search, ...withoutSearch } = filter;
  const conditions = projectConditions(scope, withoutSearch);
  if (!filter.trashed) {
    conditions.push(
      filter.archived
        ? isNotNull(projects.archivedAt)
        : isNull(projects.archivedAt),
    );
  }

  const rows = await db
    .select({
      project: projects,
      publishedAt: projectVersions.createdAt,
      creator: initialVersion.createdBy,
      appViews: appVisits.count,
      appViews7d: appVisits.count7d,
      appViews14d: appVisits.count14d,
      appViews30d: appVisits.count30d,
      appLastViewedAt: appVisits.lastViewedAt,
      directCount: shares.directCount,
      workspaceShared: shares.workspace,
    })
    .from(projects)
    .leftJoin(
      projectVersions,
      and(
        eq(projects.publishedVersionId, projectVersions.id),
        eq(projects.id, projectVersions.projectId),
        eq(projectVersions.kind, "published"),
      ),
    )
    .leftJoin(
      initialVersion,
      and(
        eq(initialVersion.projectId, projects.id),
        eq(initialVersion.number, "1"),
      ),
    )
    .crossJoinLateral(appVisits)
    .crossJoinLateral(shares)
    .where(and(...conditions))
    .orderBy(desc(projects.updatedAt), desc(projects.id));

  const needle = foldText((search ?? "").trim());
  const matching =
    needle === ""
      ? rows
      : rows.filter(
          ({ project }) =>
            foldText(project.title).includes(needle) ||
            foldText(project.description).includes(needle),
        );
  const listed = await Promise.all(
    matching.map(async (row): Promise<ProjectListRow | null> => {
      if (row.project.publishedVersionId !== null && row.publishedAt === null) {
        throw new StoredDataError(
          "A published project version is missing or invalid.",
        );
      }
      const yourAccess = await projectAccessLevel(scope, row.project);
      if (yourAccess === null) return null;
      return {
        ...toProject(row.project),
        creatorEmail: row.creator?.trim() || null,
        lastPublishedAt: row.publishedAt,
        yourAccess,
        sharedWith: {
          workspace: row.project.visibility === "org" || row.workspaceShared,
          directCount: row.directCount,
        },
        appViews: row.publishedAt === null ? null : row.appViews,
        appViewsByDuration:
          row.publishedAt === null
            ? null
            : {
                ALL_TIME: row.appViews,
                ONE_WEEK: row.appViews7d,
                TWO_WEEKS: row.appViews14d,
                ONE_MONTH: row.appViews30d,
              },
        appLastViewedAt: row.publishedAt === null ? null : row.appLastViewedAt,
      };
    }),
  );
  return listed.filter((row) => row !== null);
}

/** Searchable projects in the active workspace, subject to the sharing rollout. */
export async function listWorkspaceVisibleProjects(
  scopeInput: ProjectScope,
): Promise<
  Array<
    Project & {
      publishedVersionId: string | null;
      userUpdatedAt: string | null;
      yourAccess?: ProjectAccessLevel | undefined;
    }
  >
> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const rows = await getDb()
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.orgId, scope.orgId),
        eq(projects.listed, true),
        isNull(projects.trashedAt),
        accessFilter(projects, schema.projectShares, {
          userEmail: scope.ownerEmail,
          orgId: scope.orgId,
        }),
      ),
    )
    .orderBy(desc(projects.updatedAt), desc(projects.id));
  const viewerEmailLower = scope.ownerEmail.trim().toLowerCase();
  const nonOwnedIds = rows
    .filter((row) => row.ownerEmail.trim().toLowerCase() !== viewerEmailLower)
    .map((row) => row.id);
  const grantsByProject = new Map<string, ProjectGrant[]>();
  if (nonOwnedIds.length > 0) {
    const shareRows = await getDb()
      .select({
        resourceId: schema.projectShares.resourceId,
        principalType: schema.projectShares.principalType,
        principalId: schema.projectShares.principalId,
        role: schema.projectShares.role,
      })
      .from(schema.projectShares)
      .where(inArray(schema.projectShares.resourceId, nonOwnedIds));
    for (const share of shareRows) {
      const grant: ProjectGrant = {
        principalType: share.principalType as ProjectGrant["principalType"],
        principalId: share.principalId,
        role: share.role,
      };
      const existing = grantsByProject.get(share.resourceId);
      if (existing) existing.push(grant);
      else grantsByProject.set(share.resourceId, [grant]);
    }
  }
  return rows.map((row) => {
    const yourAccess =
      resolveProjectAccess({
        ownerEmail: row.ownerEmail,
        viewerEmail: scope.ownerEmail,
        viewerOrgId: scope.orgId,
        projectOrgId: row.orgId ?? null,
        grants: grantsByProject.get(row.id) ?? [],
        visibility: row.visibility,
      }) ?? undefined;
    return {
      ...toProject(row),
      publishedVersionId: row.publishedVersionId,
      userUpdatedAt: row.userUpdatedAt,
      ...(yourAccess ? { yourAccess } : {}),
    };
  });
}

const CELL_TEXT_SCAN_CHUNK = 200;

export async function projectIdsWithMatchingCellText(
  scopeInput: ProjectScope,
  candidates: ReadonlyArray<{
    id: string;
    ownerEmail: string;
    publishedVersionId: string | null;
  }>,
  textMatches: (text: string) => boolean,
): Promise<Set<string>> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const found = new Set<string>();
  for (const candidate of candidates) {
    if (
      candidate.publishedVersionId !== null &&
      candidate.ownerEmail !== scope.ownerEmail
    )
      found.add(candidate.id);
  }
  const ids = candidates.map((candidate) => candidate.id);
  for (let start = 0; start < ids.length; start += CELL_TEXT_SCAN_CHUNK) {
    const rows = await getDb()
      .select({
        projectId: schema.cells.projectId,
        contents: schema.cells.contents,
      })
      .from(schema.cells)
      .innerJoin(projects, eq(schema.cells.projectId, projects.id))
      .where(
        and(
          inArray(
            schema.cells.projectId,
            ids.slice(start, start + CELL_TEXT_SCAN_CHUNK),
          ),
          eq(projects.orgId, scope.orgId),
          or(
            eq(schema.cells.versionId, projects.workingVersionId),
            eq(schema.cells.versionId, projects.publishedVersionId),
          ),
        ),
      );
    for (const row of rows) {
      if (found.has(row.projectId)) continue;
      let text: string | null;
      try {
        text = cellSearchText(JSON.parse(row.contents) as object);
      } catch {
        found.add(row.projectId);
        continue;
      }
      if (text !== null && textMatches(text)) found.add(row.projectId);
    }
  }
  return found;
}

/**
 * The project's saved versions, newest first. The list is a read of history:
 * it never restores, renames or publishes anything.
 */
export async function listProjectVersions(
  scopeInput: ProjectScope,
  projectId: string,
): Promise<ProjectVersion[]> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const project = await getAuthorizedProjectRow(scope, projectId);
  if (project === null) return [];
  const rows = await getDb()
    .select()
    .from(projectVersions)
    .where(eq(projectVersions.projectId, project.id))
    .orderBy(desc(projectVersions.createdAt), desc(projectVersions.id));
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    kind: row.kind,
    name: row.name ?? null,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    isWorking: row.id === project.workingVersionId,
    isPublished: row.id === project.publishedVersionId,
  }));
}

export async function getProjectRow(
  scope: ProjectScope,
  projectId: string,
): Promise<ProjectRow | null> {
  await ensureAnalyticsDatabase();
  return getAuthorizedProjectRow(scope, projectId);
}

async function mapDocument(
  row: ProjectRow,
  scope: WorkspaceScope,
  db: Queryable,
  versionId = row.workingVersionId,
  readable = false,
  isDraft = versionId === row.workingVersionId,
  draft?: { cells: Cell[]; notebook: NotebookSnapshot },
): Promise<ProjectDocument> {
  const cells =
    draft?.cells ??
    (await (readable ? readReadableCells : readCells)(
      scope,
      row.id,
      versionId,
      db,
    ));
  const links = await db
    .select()
    .from(projectCollections)
    .where(eq(projectCollections.projectId, row.id));
  const layoutRevision = revisionSchema.parse(
    isDraft ? row.notebookLayoutRevision.toString() : "0",
  );
  const stored = draft
    ? draft.notebook.appLayout
    : await readAppDocument(db, row.orgId ?? scope.orgId, row.id, versionId);
  const appLayout = stored
    ? pruneAppLayout(stored, cells)
    : isDraft
      ? draftAppLayout(cells, layoutRevision)
      : undefined;
  const [published] =
    isDraft && row.publishedVersionId !== null
      ? await db
          .select({ head: schema.projectReleases.head })
          .from(schema.projectReleases)
          .where(
            and(
              eq(schema.projectReleases.id, row.publishedVersionId),
              eq(schema.projectReleases.orgId, row.orgId ?? scope.orgId),
              eq(schema.projectReleases.projectId, row.id),
            ),
          )
          .limit(1)
      : [];
  return {
    ...toProject(row),
    workingVersionId: row.workingVersionId,
    publishedVersionId: row.publishedVersionId ?? null,
    cells: cells.map((cell) => ({
      ...cell,
      contents: withoutPendingCellEdit(cell.contents),
    })),
    collectionIds: links.map((link) => link.collectionId),
    ...(appLayout === undefined ? {} : { appLayout }),
    ...(isDraft
      ? {
          publishedHead: published?.head ?? null,
          draftHead: draftHeadSchema.parse({
            versionId,
            revision: row.notebookRevision.toString(),
          }),
          orderRevision: revisionSchema.parse(
            row.notebookOrderRevision.toString(),
          ),
        }
      : {}),
  };
}

export function readLockedDraftDocument(
  row: ProjectRow,
  scope: WorkspaceScope,
  db: Queryable,
) {
  return mapDocument(row, scope, db);
}

export async function getProjectDocument(
  scope: ProjectScope,
  projectId: string,
  version?: string,
): Promise<ProjectDocument | null> {
  await ensureAnalyticsDatabase();
  const normalized = requireWorkspaceScope(scope);
  const row = await getAuthorizedProjectRow(normalized, projectId);
  if (row === null) return null;
  return readDocumentVersion(row, normalized, version, false);
}

export async function getReadableProjectDocument(
  scope: ProjectScope,
  projectId: string,
  version?: string,
  versionKind?: "published",
): Promise<(ProjectDocument & { notebook?: NotebookSnapshot }) | null> {
  await ensureAnalyticsDatabase();
  const normalized = requireWorkspaceScope(scope);
  const row = await getReadableProjectRow(normalized, projectId);
  if (row === null) return null;
  const access = await readableProjectAccess(normalized, row);
  const effectiveVersion = await resolveReadableVersion(
    normalized,
    row,
    access,
    version ?? (versionKind === "published" ? "latest" : undefined),
  );
  if (
    effectiveVersion === undefined &&
    row.trashedAt === null &&
    canEditProject(access)
  ) {
    const draft = await readNotebookDraft(normalized, projectId);
    if (draft)
      return {
        ...(await mapDocument(
          draft.project,
          normalized,
          getDb(),
          draft.project.workingVersionId,
          true,
          true,
          draft,
        )),
        notebook: draft.notebook,
      };
  }
  return readDocumentVersion(
    row,
    normalized,
    effectiveVersion,
    true,
    versionKind,
  );
}

export async function readableProjectVersion(
  scope: WorkspaceScope,
  project: ProjectRow,
  version?: string,
): Promise<string | undefined> {
  return resolveReadableVersion(
    scope,
    project,
    await readableProjectAccess(scope, project),
    version,
  );
}

async function readableProjectAccess(
  scope: WorkspaceScope,
  project: ProjectRow,
) {
  if (scope.orgId !== project.orgId) {
    if (!(await getReadableProjectRow(scope, project.id)))
      throw new ProjectAccessError();
    return "read" as const;
  }
  const access = await projectAccessLevel(scope, project);
  if (access === null) throw new ProjectAccessError();
  return access;
}

async function resolveReadableVersion(
  scope: WorkspaceScope,
  project: ProjectRow,
  access: ProjectAccessLevel,
  version?: string,
): Promise<string | undefined> {
  if (version !== undefined) return version;
  if (canEditProject(access) || (await canReadUnpublishedDraft(scope, project)))
    return undefined;
  return "latest";
}

async function canReadUnpublishedDraft(
  scope: WorkspaceScope,
  project: ProjectRow,
  db: Queryable = getDb(),
): Promise<boolean> {
  if (project.publishedVersionId !== null || project.trashedAt !== null)
    return false;
  const { projectShares } = schema;
  const [grant] = await db
    .select({ id: projectShares.id })
    .from(projectShares)
    .where(
      and(
        eq(projectShares.resourceId, project.id),
        eq(projectShares.principalType, "user"),
        eq(sql`lower(btrim(${projectShares.principalId}))`, scope.ownerEmail),
        inArray(
          projectShares.role,
          scope.orgId === project.orgId
            ? ["viewer", "commenter"]
            : ["viewer", "commenter", "editor", "admin"],
        ),
      ),
    )
    .limit(1);
  return grant !== undefined;
}

async function readDocumentVersion(
  row: ProjectRow,
  normalized: WorkspaceScope,
  version: string | undefined,
  readable: boolean,
  versionKind?: "published",
): Promise<ProjectDocument | null> {
  if (version === undefined) {
    const projectOrgId = row.orgId;
    if (projectOrgId === null) return null;
    return getDb().transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.id, row.id), eq(projects.orgId, projectOrgId)))
        .limit(1)
        .for("share");
      if (!current) return null;
      if (
        current.orgId !== normalized.orgId &&
        !(await getReadableProjectRow(normalized, current.id, tx))
      )
        return null;
      const access = await projectAccessLevel(normalized, current, [], tx);
      if (
        !canEditProject(access) &&
        !(readable && (await canReadUnpublishedDraft(normalized, current, tx)))
      )
        return null;
      return mapDocument(
        current,
        normalized,
        tx,
        current.workingVersionId,
        readable,
      );
    });
  }

  const versionId = version === "latest" ? row.publishedVersionId : version;
  if (versionId === null) return null;
  const matches = await getDb()
    .select({ id: projectVersions.id })
    .from(projectVersions)
    .where(
      and(
        eq(projectVersions.id, versionId),
        eq(projectVersions.projectId, row.id),
        ...(versionKind === "published" ||
        row.ownerEmail !== normalized.ownerEmail
          ? [eq(projectVersions.kind, "published")]
          : []),
      ),
    )
    .limit(1);
  if (matches[0] === undefined) return null;
  const [release] = await getDb()
    .select({ project: schema.projectReleases.project })
    .from(schema.projectReleases)
    .where(
      and(
        eq(schema.projectReleases.id, versionId),
        eq(schema.projectReleases.projectId, row.id),
        eq(schema.projectReleases.orgId, row.orgId ?? normalized.orgId),
      ),
    )
    .limit(1);
  if (release) return release.project;
  return mapDocument(row, normalized, getDb(), versionId, readable, false);
}

export type CreateProjectInput = ProjectScope & {
  title?: string;
  description?: string;
  language?: ProjectLanguage;
  /** Cells to create with the project, in order. */
  cells?: CellDraft[];
  /** Pin the timestamps, so seeded content is reproducible. */
  at?: string;
  /** Use this id instead of a fresh one. */
  projectId?: string;
  untitledOrdinal?: number;
  listed?: boolean;
};

async function writeProject(
  input: CreateProjectInput,
  scope: WorkspaceScope,
  db: Queryable,
): Promise<ProjectDocument> {
  const timestamp = input.at ?? nowIso();
  const projectId = input.projectId ?? newId("prj");
  const versionId = newId("ver");
  const title =
    input.title === undefined
      ? UNTITLED_PROJECT_NAME
      : normalizeProjectTitle(input.title) || UNTITLED_PROJECT_NAME;

  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`analytics-2:statuses:${scope.orgId}`}, 0))`,
  );
  const [defaultStatus] = await db
    .select({ id: schema.statuses.id })
    .from(schema.statuses)
    .where(
      and(
        eq(schema.statuses.orgId, scope.orgId),
        eq(schema.statuses.isDefault, true),
      ),
    )
    .limit(1);
  await db.insert(projects).values({
    id: projectId,
    ownerEmail: scope.ownerEmail,
    orgId: scope.orgId,
    title,
    untitledOrdinal: input.untitledOrdinal,
    description: input.description ?? "",
    language: input.language ?? "python",
    statusId: defaultStatus?.id ?? null,
    favorited: false,
    listed: input.listed,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: timestamp,
    userUpdatedAt: timestamp,
    workingVersionId: versionId,
    notebookVersionId: versionId,
    publishedVersionId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await db.insert(projectVersions).values({
    id: versionId,
    projectId,
    number: "1",
    kind: "autosave",
    name: null,
    createdAt: timestamp,
    createdBy: scope.ownerEmail,
  });

  const cells = await writeNotebookVersionCells(
    db,
    { projectId, versionId },
    input.cells ?? [],
    timestamp,
  );

  const row = await assertAuthorizedProject(scope, projectId, db);
  return {
    ...toProject(row),
    workingVersionId: versionId,
    publishedVersionId: null,
    cells,
    collectionIds: [],
    appLayout: draftAppLayout(cells, revisionSchema.parse("0")),
    draftHead: draftHeadSchema.parse({ versionId, revision: "0" }),
    orderRevision: revisionSchema.parse("0"),
  };
}

/**
 * Creates the project, its first version and its cells in one transaction.
 * A cell that violates a constraint rolls the whole write back, so there is
 * never a project without its notebook and a corrected retry starts clean.
 */
export async function createProject(
  input: CreateProjectInput,
  db?: Queryable,
): Promise<ProjectDocument> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(input);
  if (db !== undefined) return writeProject(input, scope, db);
  return getDb().transaction((tx) => writeProject(input, scope, tx));
}

export type UpdateProjectInput = ProjectScope & {
  projectId: string;
  title?: string;
  description?: string;
  statusId?: string | null;
  favorited?: boolean;
  trashed?: boolean;
  archived?: boolean;
};

const METADATA_WRITE_ATTEMPTS = 3;

export async function updateProject(
  input: UpdateProjectInput,
  initial?: LegacyNotebook,
): Promise<Project> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(input);
  if (
    input.favorited !== undefined ||
    input.trashed !== undefined ||
    input.archived !== undefined
  )
    await assertAuthorizedProject(scope, input.projectId);
  else await assertEditableProject(scope, input.projectId);

  const metadata = {
    ...(input.title === undefined
      ? {}
      : {
          title: normalizeProjectTitle(input.title) || UNTITLED_PROJECT_NAME,
        }),
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
    ...(input.statusId === undefined ? {} : { statusId: input.statusId }),
  };
  if (Object.keys(metadata).length > 0) {
    let latest = initial;
    for (let attempt = 1; ; attempt += 1) {
      const { notebook } =
        latest ?? (await readLegacyNotebook(scope, input.projectId));
      const receipt = await applyLegacyNotebookOperation(scope, notebook, [
        {
          type: "set-metadata",
          expectedMetadataRevision: notebook.resources.metadataRevision,
          metadata,
        },
      ]);
      if (
        receipt.status !== "conflict" ||
        attempt === METADATA_WRITE_ATTEMPTS
      ) {
        requireAppliedNotebookOperation(receipt);
        break;
      }
      latest = undefined;
    }
  }

  const timestamp = nowIso();
  const changes: Partial<typeof projects.$inferInsert> = {};
  if (input.favorited !== undefined) changes.favorited = input.favorited;
  if (input.trashed !== undefined)
    changes.trashedAt = input.trashed ? timestamp : null;
  if (input.archived !== undefined)
    changes.archivedAt = input.archived ? timestamp : null;
  if (Object.keys(changes).length > 0)
    await getDb()
      .update(projects)
      .set({
        ...changes,
        updatedAt: timestamp,
        userUpdatedAt: sql`coalesce(${projects.userUpdatedAt}, ${projects.updatedAt})`,
      })
      .where(
        and(
          eq(projects.ownerEmail, scope.ownerEmail),
          eq(projects.orgId, scope.orgId),
          eq(projects.id, input.projectId),
        ),
      );

  const row = await getReadableProjectRow(scope, input.projectId);
  if (row === null) throw new Error("The project could not be read back.");
  return toProject(row);
}

/**
 * Permanently removes a project that is already in the trash. Every dependent
 * row (versions, cells, saved outputs, collection links, dataset links) goes
 * with it through the schema's cascades; the caller is responsible for having
 * started from a trashed project, which is the only place the source offers
 * this action.
 */
export async function deleteProjectPermanently(
  scopeInput: ProjectScope,
  projectId: string,
): Promise<void> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  await withProjectFileGuard(scope, projectId, async () => {
    const [row] = await getDb()
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.ownerEmail, scope.ownerEmail),
          eq(projects.orgId, scope.orgId),
          eq(projects.id, projectId),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) throw new ProjectAccessError();
    if (row.trashedAt === null) {
      fail(
        "Move the project to the trash first; only a trashed project can be permanently deleted.",
        { statusCode: 409, errorCode: "project_not_trashed" },
      );
    }
    await purgeProjectFiles(scope, projectId);
    await getDb()
      .update(schema.notebookCreationReceipts)
      .set({ receipt: null })
      .where(
        and(
          eq(schema.notebookCreationReceipts.orgId, scope.orgId),
          eq(schema.notebookCreationReceipts.projectId, projectId),
        ),
      );
    await getDb()
      .delete(projects)
      .where(
        and(
          eq(projects.ownerEmail, scope.ownerEmail),
          eq(projects.orgId, scope.orgId),
          eq(projects.id, projectId),
        ),
      );
  });
  await sweepDataframeBlobs(scope, projectId);
}

/** Records that the project was opened; this orders the recents list. */
export async function touchProject(
  scopeInput: ProjectScope,
  projectId: string,
): Promise<void> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  await getDb()
    .update(projects)
    .set({ lastOpenedAt: nowIso() })
    .where(
      and(
        eq(projects.ownerEmail, scope.ownerEmail),
        eq(projects.orgId, scope.orgId),
        eq(projects.id, projectId),
      ),
    );
}

export async function latestVersionNumber(
  projectId: string,
  db: Queryable,
): Promise<number> {
  const rows = await db
    .select({
      number: sql<
        string | null
      >`max(case when ${projectVersions.number} ~ '^[0-9]+$'
        then ${projectVersions.number}::numeric end)::text`,
    })
    .from(projectVersions)
    .where(eq(projectVersions.projectId, projectId))
    .limit(1);
  const number = rows[0]?.number;
  return number == null ? 0 : Number(number);
}

export async function ensureWorkingProjectDraft(
  scopeInput: ProjectScope,
  projectId: string,
): Promise<ProjectRow> {
  await ensureAnalyticsDatabase();
  const scope = requireWorkspaceScope(scopeInput);
  const project = await assertEditableProject(scope, projectId);
  if (
    project.trashedAt !== null ||
    project.notebookVersionId === project.workingVersionId
  )
    return project;
  await adoptNotebook(scope, projectId);
  return assertEditableProject(scope, projectId);
}

/** Published rows from older projects fork only when a write needs a draft. */
export async function forkLegacyPublishedVersion(
  scope: WorkspaceScope,
  project: ProjectRow,
  currentCells: Awaited<ReturnType<typeof readNotebookCells>>,
  lockedCellIds: string[],
  tx: Queryable,
): Promise<ProjectRow> {
  const [version] = await tx
    .select({ kind: projectVersions.kind })
    .from(projectVersions)
    .where(
      and(
        eq(projectVersions.id, project.workingVersionId),
        eq(projectVersions.projectId, project.id),
      ),
    )
    .limit(1);
  if (!version)
    throw new ProjectAccessError("The project's working version is missing.");
  if (version.kind !== "published") return project;

  const versionId = newId("ver");
  const timestamp = nowIso();
  await tx.insert(projectVersions).values({
    id: versionId,
    projectId: project.id,
    number: String((await latestVersionNumber(project.id, tx)) + 1),
    kind: "autosave",
    name: null,
    createdAt: timestamp,
    createdBy: scope.ownerEmail,
  });
  return installNotebookLineage(
    tx,
    scope,
    project,
    versionId,
    project.workingVersionId,
    currentCells,
    currentCells,
    lockedCellIds,
    timestamp,
  );
}

/** Copies a project, its working cells and its collection links atomically. */
export async function duplicateProject(
  scopeInput: ProjectScope,
  projectId: string,
  title?: string,
): Promise<ProjectDocument> {
  const scope = requireWorkspaceScope(scopeInput);
  const source = await getProjectDocument(scope, projectId);
  if (source === null) {
    throw new Error("That project is not in this workspace.");
  }
  const copies = source.cells.map((cell) => ({
    sourceId: cell.id,
    contents: { ...withoutPendingCellEdit(cell.contents), id: newId("cel") },
  }));
  const copyIds = new Map(
    copies.map(({ sourceId, contents }) => [sourceId, contents.id]),
  );

  return getDb().transaction(async (tx) => {
    const copy = await createProject(
      {
        ...scope,
        title: title ?? `${source.title} (copy)`,
        description: source.description,
        language: source.language,
        cells: copies.map(({ contents: sourceContents }) => {
          const parent = sourceContents.parentSectionId;
          const parentSectionId = parent == null ? parent : copyIds.get(parent);
          if (parent != null && parentSectionId === undefined)
            throw new StoredDataError(
              "A Section parent is missing from the source project.",
            );
          const contents =
            parentSectionId === undefined
              ? sourceContents
              : { ...sourceContents, parentSectionId };
          if (contents.kind === "chart" && contents.chartSpec.sourceCellId) {
            const sourceCellId = copyIds.get(contents.chartSpec.sourceCellId);
            if (sourceCellId)
              return {
                ...contents,
                chartSpec: { ...contents.chartSpec, sourceCellId },
              };
          }
          if (
            contents.kind === "pivot" &&
            contents.pivotConfig?.version === 2
          ) {
            const { pivotConfig } = contents;
            const binding = pivotConfig.source;
            const cellId = binding ? copyIds.get(binding.cellId) : undefined;
            if (binding && cellId)
              return {
                ...contents,
                pivotConfig: { ...pivotConfig, source: { ...binding, cellId } },
              };
          }
          if (contents.kind === "display-table" && contents.tableConfig) {
            const { tableConfig } = contents;
            const binding = tableConfig.source;
            const cellId = binding ? copyIds.get(binding.cellId) : undefined;
            if (binding && cellId)
              return {
                ...contents,
                tableConfig: { ...tableConfig, source: { ...binding, cellId } },
              };
          }
          if (contents.kind === "metric" && contents.metricConfig?.source) {
            const { metricConfig } = contents;
            const binding = contents.metricConfig.source;
            const cellId = copyIds.get(binding.cellId);
            if (cellId)
              return {
                ...contents,
                metricConfig: {
                  ...metricConfig,
                  source: { ...binding, cellId },
                },
              };
          }
          return contents;
        }),
      },
      tx,
    );
    if (source.appLayout?.initialized) {
      const layout = appDocumentSchema.parse({
        ...source.appLayout,
        revision: revisionSchema.parse("0"),
        tabs: source.appLayout.tabs.map((tab) => ({
          ...tab,
          rows: tab.rows.map((row) => ({
            ...row,
            columns: row.columns.map((column) => ({
              ...column,
              elements: column.elements.flatMap((element) => {
                const cellId = copyIds.get(element.cellId);
                return cellId === undefined ? [] : [{ ...element, cellId }];
              }),
            })),
          })),
        })),
      });
      await writeAppDocument(
        tx,
        scope.orgId,
        copy.id,
        copy.workingVersionId,
        layout,
      );
      copy.appLayout = layout;
    }
    if (source.collectionIds.length > 0) {
      const owned = await tx
        .select({ id: schema.collections.id })
        .from(schema.collections)
        .where(
          and(
            eq(schema.collections.ownerEmail, scope.ownerEmail),
            eq(schema.collections.orgId, scope.orgId),
          ),
        );
      const allowed = new Set(owned.map((collection) => collection.id));
      const links = source.collectionIds.filter((id) => allowed.has(id));
      if (links.length > 0) {
        await tx.insert(projectCollections).values(
          links.map((collectionId) => ({
            projectId: copy.id,
            collectionId,
            addedAt: nowIso(),
          })),
        );
      }
    }
    return copy;
  });
}

/** Every cell of a project version, decoded, in display order. */
export async function projectCells(
  scope: ProjectScope,
  projectId: string,
  versionId?: string,
): Promise<Cell[]> {
  const normalized = requireWorkspaceScope(scope);
  const row = await getAuthorizedProjectRow(normalized, projectId);
  if (row === null) return [];
  return readCells(
    normalized,
    row.id,
    versionId ?? row.workingVersionId,
    getDb(),
  );
}

export async function projectIdsWithSqlCell(
  projectIds: readonly string[],
): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  await ensureAnalyticsDatabase();
  const found = await getDb()
    .selectDistinct({ projectId: schema.cells.projectId })
    .from(schema.cells)
    .innerJoin(
      projects,
      and(
        eq(projects.id, schema.cells.projectId),
        eq(projects.workingVersionId, schema.cells.versionId),
      ),
    )
    .where(
      and(
        inArray(schema.cells.projectId, [...projectIds]),
        eq(schema.cells.kind, "sql"),
      ),
    );
  return new Set(found.map(({ projectId }) => projectId));
}

/** Restore a saved published snapshot as a new working draft. */
function versionOperation(
  input: SaveProjectVersionInput | RestoreProjectVersionInput,
) {
  const { opId, observedHead } = input;
  const intent =
    "name" in input ? ["checkpoint", input.name] : ["restore", input.versionId];
  return {
    opId,
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify([
          observedHead.versionId,
          observedHead.revision,
          ...intent,
        ]),
      )
      .digest("hex"),
  };
}

function assertVersionHead(
  scope: ProjectScope,
  project: ProjectRow,
  observedHead: DraftHead,
) {
  const { head } = snapshotRef(scope, project);
  if (
    project.trashedAt !== null ||
    project.notebookVersionId !== head.versionId ||
    head.versionId !== observedHead.versionId ||
    head.revision !== observedHead.revision
  )
    fail("The draft changed. Review the current draft before trying again.", {
      statusCode: 409,
      errorCode: "project_version_changed",
      details: { head },
    });
}

async function selectSavedVersion(
  tx: Queryable,
  projectId: string,
  versionId: string,
) {
  const [version] = await tx
    .select()
    .from(projectVersions)
    .where(
      and(
        eq(projectVersions.projectId, projectId),
        eq(projectVersions.id, versionId),
      ),
    )
    .limit(1);
  return version;
}

export async function captureDraftVersionOutputs(
  tx: Queryable,
  projectId: string,
  cellIds: string[],
) {
  if (cellIds.length === 0) return [];
  const { cellOutputs, cellOutputGenerations } = schema;
  return tx
    .select({
      projectId: cellOutputs.projectId,
      cellId: cellOutputs.cellId,
      status: cellOutputs.status,
      output: cellOutputs.output,
      ranAt: cellOutputs.ranAt,
      sourceConnectionId: cellOutputs.sourceConnectionId,
      connectionProvenanceRecorded: cellOutputs.connectionProvenanceRecorded,
    })
    .from(cellOutputs)
    .innerJoin(
      cellOutputGenerations,
      and(
        eq(cellOutputs.projectId, cellOutputGenerations.projectId),
        eq(cellOutputs.cellId, cellOutputGenerations.cellId),
        eq(cellOutputs.runId, cellOutputGenerations.generation),
      ),
    )
    .where(
      and(
        eq(cellOutputs.projectId, projectId),
        inArray(cellOutputs.cellId, cellIds),
        isNull(cellOutputs.undo),
        isNotNull(cellOutputs.output),
        eq(cellOutputs.connectionProvenanceRecorded, true),
        inArray(cellOutputs.status, ["complete", "error"]),
      ),
    );
}

export async function saveProjectVersion(
  scope: ProjectScope,
  input: SaveProjectVersionInput,
) {
  await ensureAnalyticsDatabase();
  const { projectId, observedHead } = input;
  const operation = versionOperation(input);
  return getDb().transaction(async (tx) => {
    const project = await lockNotebookProject(scope, projectId, tx, "update");
    if (project.ownerEmail !== scope.ownerEmail) throw new ProjectAccessError();
    const prior = await readNotebookVersionOperation(
      tx,
      scope,
      projectId,
      operation,
    );
    if (prior) {
      if (prior.versionChange?.type !== "checkpoint")
        throw new StoredDataError("The saved version receipt is unreadable.");
      const version = await selectSavedVersion(
        tx,
        projectId,
        prior.versionChange.versionId,
      );
      if (!version || version.kind !== "named")
        throw new StoredDataError("The saved version receipt is unreadable.");
      return {
        version: projectVersionSchema.parse({
          ...version,
          isWorking: false,
          isPublished: false,
        }),
        head: prior.nextHead,
        eventSeq: prior.eventSeq,
      };
    }
    assertVersionHead(scope, project, observedHead);
    const cells = await readNotebookCells(project, tx);
    const at = nowIso();
    const id = newId("ver");
    const outputs = await captureDraftVersionOutputs(
      tx,
      projectId,
      cells.map(({ id }) => id),
    );
    const version = {
      id,
      number: String((await latestVersionNumber(projectId, tx)) + 1),
      kind: "named" as const,
      name: input.name,
      createdAt: at,
      createdBy: scope.ownerEmail,
      isWorking: false,
      isPublished: false,
    };
    await tx
      .insert(projectVersions)
      .values({ ...version, projectId, capturedOutputCount: outputs.length });
    await writeNotebookVersionCells(
      tx,
      { projectId, versionId: id },
      cells.map(({ contents }) => withoutPendingCellEdit(contents)),
      at,
    );
    const layout = await readAppDocument(
      tx,
      scope.orgId,
      projectId,
      project.workingVersionId,
    );
    await writeAppDocument(
      tx,
      scope.orgId,
      projectId,
      id,
      layout
        ? pruneAppLayout(layout, cells)
        : draftAppLayout(
            cells,
            revisionSchema.parse(project.notebookLayoutRevision.toString()),
          ),
    );
    if (outputs.length > 0)
      await tx
        .insert(schema.publishedCellOutputs)
        .values(outputs.map((output) => ({ ...output, versionId: id })));
    const receipt = await recordNotebookCheckpoint(
      tx,
      scope,
      project,
      id,
      operation,
      at,
    );
    return { version, head: receipt.nextHead, eventSeq: receipt.eventSeq };
  });
}

export async function restoreProjectVersion(
  scope: ProjectScope,
  input: RestoreProjectVersionInput,
) {
  await ensureAnalyticsDatabase();
  const { projectId, versionId: sourceVersionId, observedHead } = input;
  const operation = versionOperation(input);
  const restored = await getDb().transaction(async (tx) => {
    const initial = await assertAuthorizedProject(scope, projectId, tx);
    const previous = await readNotebookVersionOperation(
      tx,
      scope,
      projectId,
      operation,
    );
    if (previous) {
      const project = await lockNotebookProject(scope, projectId, tx, "share");
      if (project.ownerEmail !== scope.ownerEmail)
        throw new ProjectAccessError();
      return {
        project: await mapDocument(project, scope, tx),
        head: previous.nextHead,
        eventSeq: previous.eventSeq,
      };
    }
    assertVersionHead(scope, initial, observedHead);
    const sourceVersion = await selectSavedVersion(
      tx,
      projectId,
      sourceVersionId,
    );
    if (!sourceVersion || sourceVersionId === initial.workingVersionId)
      fail("That version is not available.", {
        statusCode: 404,
        errorCode: "project_version_not_found",
      });
    const sourceCells = await readNotebookCells(
      { ...initial, workingVersionId: sourceVersionId },
      tx,
    );
    const oldCells = await readNotebookCells(initial, tx);
    const ids = [
      ...new Set([...sourceCells, ...oldCells].map((cell) => cell.id)),
    ].sort();
    for (const id of ids) await lockCellOutputForEdit(projectId, id, tx);
    await lockNotebookRunOutputs(
      tx,
      draftNamespace(scope, projectId).namespaceId,
      ids.map((id) => notebookCellIdSchema.parse(id)),
      true,
    );
    const locked = await lockNotebookProject(scope, projectId, tx, "update");
    if (locked.ownerEmail !== scope.ownerEmail) throw new ProjectAccessError();
    const replay = await readNotebookVersionOperation(
      tx,
      scope,
      projectId,
      operation,
    );
    if (replay)
      return {
        project: await mapDocument(locked, scope, tx),
        head: replay.nextHead,
        eventSeq: replay.eventSeq,
      };
    assertVersionHead(scope, locked, observedHead);
    const currentCells = await readNotebookCells(locked, tx);
    const snapshot = await tx
      .select()
      .from(schema.publishedCellOutputs)
      .where(
        and(
          eq(schema.publishedCellOutputs.projectId, projectId),
          eq(schema.publishedCellOutputs.versionId, sourceVersionId),
        ),
      );
    if (
      sourceVersion.capturedOutputCount === null ||
      sourceVersion.capturedOutputCount !== snapshot.length
    )
      fail("This version's saved results are unavailable.", {
        statusCode: 409,
        errorCode: "published_snapshot_unavailable",
      });
    const timestamp = new Date(
      Math.max(
        Date.now(),
        ...[...sourceCells, ...currentCells].map(
          (cell) => Date.parse(cell.updatedAt) + 1,
        ),
      ),
    ).toISOString();
    const oldOutputs = await captureDraftVersionOutputs(
      tx,
      projectId,
      currentCells.map(({ id }) => id),
    );
    const [archived] = await tx
      .update(projectVersions)
      .set({ capturedOutputCount: oldOutputs.length, archivedAt: timestamp })
      .where(
        and(
          eq(projectVersions.projectId, projectId),
          eq(projectVersions.id, locked.workingVersionId),
          eq(projectVersions.kind, "autosave"),
          isNull(projectVersions.capturedOutputCount),
        ),
      )
      .returning({ id: projectVersions.id });
    if (archived) {
      const layout = await readAppDocument(
        tx,
        scope.orgId,
        projectId,
        archived.id,
      );
      if (layout === null) {
        const revision = revisionSchema.parse(
          locked.notebookLayoutRevision.toString(),
        );
        await writeAppDocument(
          tx,
          scope.orgId,
          projectId,
          archived.id,
          draftAppLayout(currentCells, revision),
        );
      }
      if (oldOutputs.length > 0)
        await tx
          .insert(schema.publishedCellOutputs)
          .values(
            oldOutputs.map((output) => ({ ...output, versionId: archived.id })),
          );
    }
    const versionId = newId("ver");
    await tx.insert(projectVersions).values({
      id: versionId,
      projectId,
      number: String((await latestVersionNumber(projectId, tx)) + 1),
      kind: "autosave",
      name: null,
      createdAt: timestamp,
      createdBy: scope.ownerEmail,
    });
    const row = await installNotebookLineage(
      tx,
      scope,
      locked,
      versionId,
      sourceVersionId,
      currentCells,
      sourceCells.map((cell) => ({
        ...cell,
        contents: withoutPendingCellEdit(cell.contents),
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
      ids,
      timestamp,
      operation,
    );
    await tx
      .delete(schema.cellOutputs)
      .where(eq(schema.cellOutputs.projectId, projectId));
    const restoredCellIds = new Set(sourceCells.map(({ id }) => id));
    const restoredOutputs = snapshot.filter(
      (output) =>
        restoredCellIds.has(output.cellId) &&
        output.connectionProvenanceRecorded &&
        (output.status === "complete" || output.status === "error") &&
        output.output !== null,
    );
    if (restoredOutputs.length > 0) {
      const generations = await tx
        .select({
          cellId: schema.cellOutputGenerations.cellId,
          generation: schema.cellOutputGenerations.generation,
        })
        .from(schema.cellOutputGenerations)
        .where(
          and(
            eq(schema.cellOutputGenerations.projectId, projectId),
            inArray(
              schema.cellOutputGenerations.cellId,
              restoredOutputs.map(({ cellId }) => cellId),
            ),
          ),
        );
      const byCell = new Map(
        generations.map(({ cellId, generation }) => [cellId, generation]),
      );
      await tx.insert(schema.cellOutputs).values(
        restoredOutputs.map(({ versionId: _versionId, ...output }) => {
          const runId = byCell.get(output.cellId);
          if (runId === undefined)
            throw new StoredDataError(
              "The restored result generation is missing.",
            );
          return { ...output, runId };
        }),
      );
    }
    const { head, eventSeq } = snapshotRef(scope, row);
    return { project: await mapDocument(row, scope, tx), head, eventSeq };
  });
  await sweepDataframeBlobs(requireWorkspaceScope(scope), projectId);
  return restored;
}
