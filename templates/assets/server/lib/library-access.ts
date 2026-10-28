import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  assertAccess,
  ForbiddenError,
  roleSatisfies,
  type ShareRole,
} from "@agent-native/core/sharing";
import {
  and,
  eq,
  inArray,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

export const DRAFT_ROLE: ShareRole = "viewer";
export const APPROVE_ROLE: ShareRole = "editor";

export function draftProvenanceAccess(libraryId: string): {
  resourceType: "asset-library";
  resourceId: string;
  recordMinRole: "viewer";
} {
  return {
    resourceType: "asset-library",
    resourceId: libraryId,
    recordMinRole: "viewer",
  };
}

export interface LibraryWriteAccess {
  role: ShareRole | "owner";
  canApprove: boolean;
}

export async function assertCanDraft(
  libraryId: string,
): Promise<LibraryWriteAccess> {
  const access = await assertAccess(
    "asset-library",
    libraryId,
    DRAFT_ROLE,
    undefined,
    { skipResourceBody: true },
  );
  return {
    role: access.role,
    canApprove: roleSatisfies(access.role, APPROVE_ROLE),
  };
}

export async function assertCanApprove(
  libraryId: string,
  what: string,
): Promise<LibraryWriteAccess> {
  const access = await assertCanDraft(libraryId);
  if (access.canApprove) return access;
  throw draftRefusal(
    libraryId,
    access.role,
    `${what} needs edit access on this brand kit — you can generate drafts ` +
      `here and ask an editor to approve them.`,
  );
}

function draftRefusal(
  libraryId: string,
  role: ShareRole | "owner",
  remedy: string,
): ForbiddenError {
  return new ForbiddenError(
    `Requires ${APPROVE_ROLE} role on asset-library ${libraryId} ` +
      `(have ${role}). ${remedy}`,
  );
}

export async function assertCanDraftAuthoredBy(
  libraryId: string,
  authorEmail: string | null | undefined,
  what: string,
): Promise<LibraryWriteAccess> {
  const access = await assertCanDraft(libraryId);
  if (access.canApprove) return access;
  const caller = normalizeEmail(getRequestUserEmail());
  if (caller && caller === normalizeEmail(authorEmail)) return access;
  throw draftRefusal(
    libraryId,
    access.role,
    `${what} you did not create needs edit access on this brand kit — you ` +
      `can still draft in your own.`,
  );
}

export interface DraftReadScope {
  unrestricted: boolean;
  approvableLibraryIds: Set<string>;
  ownRunIds: Set<string>;
  callerEmail: string | null;
}

export async function resolveDraftReadScope(
  libraryIds: string[],
): Promise<DraftReadScope> {
  const uniqueIds = Array.from(new Set(libraryIds.filter(Boolean)));
  const approvableLibraryIds = new Set<string>();
  const roles = await Promise.all(
    uniqueIds.map(async (id) => {
      const access = await assertCanDraft(id);
      return [id, access.canApprove] as const;
    }),
  );
  for (const [id, canApprove] of roles) {
    if (canApprove) approvableLibraryIds.add(id);
  }
  const caller = normalizeEmail(getRequestUserEmail());
  const restricted = uniqueIds.filter((id) => !approvableLibraryIds.has(id));
  if (restricted.length === 0) {
    return {
      unrestricted: true,
      approvableLibraryIds,
      ownRunIds: new Set(),
      callerEmail: caller,
    };
  }
  if (!caller) {
    return {
      unrestricted: false,
      approvableLibraryIds,
      ownRunIds: new Set(),
      callerEmail: null,
    };
  }
  const rows = await getDb()
    .select({
      id: schema.assetGenerationRuns.id,
      ownerEmail: schema.assetGenerationRuns.ownerEmail,
    })
    .from(schema.assetGenerationRuns)
    .where(inArray(schema.assetGenerationRuns.libraryId, restricted));
  const ownRunIds = new Set(
    rows
      .filter((row) => normalizeEmail(row.ownerEmail) === caller)
      .map((row) => row.id),
  );
  return {
    unrestricted: false,
    approvableLibraryIds,
    ownRunIds,
    callerEmail: caller,
  };
}

export function unrestrictedDraftReadScope(): DraftReadScope {
  return {
    unrestricted: true,
    approvableLibraryIds: new Set(),
    ownRunIds: new Set(),
    callerEmail: normalizeEmail(getRequestUserEmail()),
  };
}

export function canReadDraftAsset(
  scope: DraftReadScope,
  asset: {
    libraryId: string;
    role?: string | null;
    status?: string | null;
    generationRunId?: string | null;
  },
): boolean {
  if (asset.role !== "generated" || asset.status !== "candidate") return true;
  if (scope.unrestricted) return true;
  if (scope.approvableLibraryIds.has(asset.libraryId)) return true;
  return Boolean(
    asset.generationRunId && scope.ownRunIds.has(asset.generationRunId),
  );
}

export function canReadRun(
  scope: DraftReadScope,
  run: { id: string; libraryId: string },
): boolean {
  if (scope.unrestricted) return true;
  if (scope.approvableLibraryIds.has(run.libraryId)) return true;
  return scope.ownRunIds.has(run.id);
}

export function draftReadFilter(
  scope: DraftReadScope,
  table: {
    libraryId: AnyColumn;
    generationRunId: AnyColumn;
  },
): SQL | undefined {
  if (scope.unrestricted) return undefined;
  const clauses: SQL[] = [];
  if (scope.approvableLibraryIds.size) {
    clauses.push(
      inArray(table.libraryId, Array.from(scope.approvableLibraryIds)),
    );
  }
  if (scope.ownRunIds.size) {
    clauses.push(inArray(table.generationRunId, Array.from(scope.ownRunIds)));
  }
  // No approvable kit and no run of their own: this caller authored none of the
  // candidates in scope, so the query must return nothing rather than fall
  // through to an unfiltered read.
  if (!clauses.length) return sql`1 = 0`;
  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

export function runReadFilter(
  scope: DraftReadScope,
  table: { id: AnyColumn; libraryId: AnyColumn },
): SQL | undefined {
  if (scope.unrestricted) return undefined;
  const clauses: SQL[] = [];
  if (scope.approvableLibraryIds.size) {
    clauses.push(
      inArray(table.libraryId, Array.from(scope.approvableLibraryIds)),
    );
  }
  if (scope.ownRunIds.size) {
    clauses.push(inArray(table.id, Array.from(scope.ownRunIds)));
  }
  if (!clauses.length) return sql`1 = 0`;
  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

export function sessionReadFilter(
  scope: DraftReadScope,
  table: { libraryId: AnyColumn; createdBy: AnyColumn },
): SQL | undefined {
  if (scope.unrestricted) return undefined;
  const clauses: SQL[] = [];
  if (scope.approvableLibraryIds.size) {
    clauses.push(
      inArray(table.libraryId, Array.from(scope.approvableLibraryIds)),
    );
  }
  if (scope.callerEmail) {
    clauses.push(sql`lower(${table.createdBy}) = ${scope.callerEmail}`);
  }
  if (!clauses.length) return sql`1 = 0`;
  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

export function canReadSession(
  scope: DraftReadScope,
  session: { libraryId: string; createdBy?: string | null },
): boolean {
  if (scope.unrestricted) return true;
  if (scope.approvableLibraryIds.has(session.libraryId)) return true;
  return Boolean(
    scope.callerEmail &&
    scope.callerEmail === normalizeEmail(session.createdBy),
  );
}

/**
 * Delete a draft against the state that authorized it.
 *
 * Authorization comes from a prior read, so an editor can approve the candidate
 * in between. The predicate makes that save win, and the confirming re-read
 * keeps the answer explicit about whether the row was deleted. Returns false
 * when the row survived, which callers must treat as "not deleted" rather than
 * as success.
 */
export async function deleteDraftAssetIfUnchanged(asset: {
  id: string;
  libraryId: string;
}): Promise<boolean> {
  const db = getDb();
  await db
    .delete(schema.assets)
    .where(
      and(
        eq(schema.assets.id, asset.id),
        eq(schema.assets.libraryId, asset.libraryId),
        eq(schema.assets.role, "generated"),
        eq(schema.assets.status, "candidate"),
      ),
    );
  const [survivor] = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(eq(schema.assets.id, asset.id))
    .limit(1);
  return !survivor;
}

export async function draftScopeForLibrary(
  libraryId: string,
  access?: LibraryWriteAccess,
): Promise<DraftReadScope> {
  if (access?.canApprove) return unrestrictedDraftReadScope();
  return resolveDraftReadScope([libraryId]);
}

export function assertCanUseAssets(
  scope: DraftReadScope,
  libraryId: string,
  role: ShareRole | "owner",
  assets: Array<{
    id: string;
    libraryId: string;
    role?: string | null;
    status?: string | null;
    generationRunId?: string | null;
  }>,
  what: string,
): void {
  for (const asset of assets) {
    if (canReadDraftAsset(scope, asset)) continue;
    throw draftRefusal(
      libraryId,
      role,
      `${what} references draft ${asset.id}, which belongs to whoever ` +
        `generated it. Use your own draft or a saved asset.`,
    );
  }
}

export function assertCanUseRuns(
  scope: DraftReadScope,
  libraryId: string,
  role: ShareRole | "owner",
  runs: Array<{ id: string; libraryId: string }>,
  what: string,
): void {
  for (const run of runs) {
    if (canReadRun(scope, run)) continue;
    throw draftRefusal(
      libraryId,
      role,
      `${what} references generation run ${run.id}, which belongs to whoever ` +
        `started it. Use your own run.`,
    );
  }
}

export async function assertCanDeleteAsset(asset: {
  libraryId: string;
  role?: string | null;
  status?: string | null;
  generationRunId?: string | null;
}): Promise<LibraryWriteAccess> {
  const isUnsavedDraft =
    asset.role === "generated" && asset.status === "candidate";
  if (!isUnsavedDraft) {
    return assertCanApprove(asset.libraryId, "Deleting an asset");
  }
  const author = asset.generationRunId
    ? await draftAuthorEmail(asset.generationRunId)
    : null;
  return assertCanDraftAuthoredBy(asset.libraryId, author, "A draft");
}

async function draftAuthorEmail(runId: string): Promise<string | null> {
  const [run] = await getDb()
    .select({ ownerEmail: schema.assetGenerationRuns.ownerEmail })
    .from(schema.assetGenerationRuns)
    .where(eq(schema.assetGenerationRuns.id, runId))
    .limit(1);
  return run?.ownerEmail ?? null;
}

function normalizeEmail(email: string | null | undefined): string | null {
  return email?.trim().toLowerCase() || null;
}
