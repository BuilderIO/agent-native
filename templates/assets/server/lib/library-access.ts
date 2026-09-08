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

/**
 * Brand kits split writing into drafting and approving.
 *
 * Drafting is what a `viewer` may do: create generation runs and generation
 * sessions, and produce `image_assets` rows with `role: "generated"` and
 * `status: "candidate"`. None of that reaches the kit's content —
 * `shouldIncludeAssetInLibraryResults` keeps unsaved candidates out of every
 * library read — so it is a write a read-only collaborator can safely make.
 *
 * Approving is everything that changes what the kit *is*: promoting a
 * candidate to `saved`, uploads, imports, folders, collections, style brief,
 * canonical logo, templates, deletes. That still requires `editor`.
 *
 * Route new generation paths through `assertCanDraft` and new save/organize
 * paths through `assertCanApprove` instead of picking a role literal per
 * action, so the boundary stays readable in one place.
 */
export const DRAFT_ROLE: ShareRole = "viewer";
export const APPROVE_ROLE: ShareRole = "editor";

export interface LibraryWriteAccess {
  role: ShareRole | "owner";
  /** True when this caller may save and organize, not only draft. */
  canApprove: boolean;
}

/**
 * Assert the caller may draft in this kit, and report whether they may also
 * approve. Throws `ForbiddenError` when they cannot even read the kit.
 */
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

/**
 * Assert the caller may change the kit itself, not just draft in it.
 *
 * The thrown message deliberately keeps the framework's
 * `Requires editor role on asset-library <id> (have viewer)` wording: the
 * agent's permanent-precondition classifier matches that shape and ends the
 * turn instead of burning retries on a grant it cannot obtain. `what` names
 * the blocked step so the remedy is legible to a human too.
 */
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

/**
 * Every draft refusal keeps the framework's
 * `Requires editor role on asset-library <id> (have viewer)` opening, because
 * core's permanent-precondition classifier matches that shape and ends the
 * agent turn instead of retrying a grant the model cannot obtain. It is also
 * literally the remedy: an editor may act on any draft in the kit.
 */
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

/**
 * Drafting in a kit does not extend to someone else's drafting workspace: a
 * below-editor caller may only change a session or run they authored. Legacy
 * rows with no recorded author therefore need `editor`.
 */
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

/**
 * Who may read an unsaved draft.
 *
 * A draft is visible to the person who generated it and to anyone who could
 * approve it — an editor has to see a proposal to act on it, and a fellow
 * drafter has no business reading someone else's unsaved prompts and previews.
 * Saved kit content is unaffected: this scope only ever narrows candidates.
 *
 * Resolve it once per read and pass it to `canReadDraftAsset` per row. The
 * per-kit role lookups only run for candidate-bearing reads, so ordinary asset
 * lists pay nothing.
 */
export interface DraftReadScope {
  /** True when every kit in the read is approvable, so nothing is filtered. */
  unrestricted: boolean;
  approvableLibraryIds: Set<string>;
  /** The caller's own generation runs in the kits they cannot approve. */
  ownRunIds: Set<string>;
  /**
   * Captured when the scope is resolved, so every predicate below is a pure
   * function of the scope. Reading it from the ambient request context instead
   * makes a row check silently answer "not yours" whenever it runs outside the
   * context that resolved the scope.
   */
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

/**
 * The no-op scope, for a caller already known to approve everywhere in the
 * read. Lets an approver-side read skip the run lookup entirely.
 */
export function unrestrictedDraftReadScope(): DraftReadScope {
  return {
    unrestricted: true,
    approvableLibraryIds: new Set(),
    ownRunIds: new Set(),
    callerEmail: normalizeEmail(getRequestUserEmail()),
  };
}

/** True when this row is not a draft, or is a draft this caller may read. */
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

/**
 * The run rows behind drafts carry the same prompts and settings, so a kit's
 * run history narrows the same way its candidates do.
 */
export function canReadRun(
  scope: DraftReadScope,
  run: { id: string; libraryId: string },
): boolean {
  if (scope.unrestricted) return true;
  if (scope.approvableLibraryIds.has(run.libraryId)) return true;
  return scope.ownRunIds.has(run.id);
}

/**
 * The scope as a WHERE clause, for a query that pages candidates.
 *
 * Filtering in JS after `limit` silently drops authorized rows — a viewer asks
 * for 50 drafts, the newest 50 belong to other people, and they get none while
 * their own sit just past the cut. Returns `undefined` when nothing is
 * filtered, so callers can skip adding a clause.
 */
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

/**
 * The scope as a WHERE clause for run history. Runs carry the prompts and
 * settings behind a draft, so they narrow to their author the same way.
 */
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

/**
 * Handoff sessions hold a brief, feedback, and references to candidates, so a
 * below-approver caller sees only the sessions they created. Filtering in SQL
 * rather than after `limit` keeps a caller's own sessions from being paged out
 * behind other people's.
 */
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
    // Case-insensitive to match how core's own access filter compares emails.
    clauses.push(sql`lower(${table.createdBy}) = ${scope.callerEmail}`);
  }
  if (!clauses.length) return sql`1 = 0`;
  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

/** The row-level counterpart of `sessionReadFilter`, for reads by id. */
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

/**
 * The draft scope for one kit, free when the caller can already approve there.
 * Use this in write paths that also read candidates as input.
 */
export async function draftScopeForLibrary(
  libraryId: string,
  access?: LibraryWriteAccess,
): Promise<DraftReadScope> {
  if (access?.canApprove) return unrestrictedDraftReadScope();
  return resolveDraftReadScope([libraryId]);
}

/**
 * Guard the *input* side of the same boundary `canReadDraftAsset` guards on
 * reads. A draft this caller cannot read must not become a generation
 * reference, a lineage source, or a session attachment either — otherwise the
 * private-candidate rule holds on the list surfaces and leaks through every
 * path that takes an asset id.
 */
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

/** The same guard for run rows, whose prompts and settings are just as private. */
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

/**
 * Removing a row from a kit is approving-class work, with one exception: an
 * unsaved generated candidate is a draft, so its author may discard their own
 * even with read-only access. Authorship lives on the generation run — the
 * asset row itself records no drafting identity — so a candidate with no run
 * behind it falls back to needing `editor`.
 */
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
