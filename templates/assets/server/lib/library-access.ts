import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  assertAccess,
  ForbiddenError,
  roleSatisfies,
  type ShareRole,
} from "@agent-native/core/sharing";
import { eq, inArray } from "drizzle-orm";

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
  throw new ForbiddenError(
    `Requires ${APPROVE_ROLE} role on asset-library ${libraryId} ` +
      `(have ${access.role}). ${what} needs edit access on this brand kit — ` +
      `you can generate drafts here and ask an editor to approve them.`,
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
  throw new ForbiddenError(
    `Requires ${APPROVE_ROLE} role on asset-library ${libraryId} ` +
      `(have ${access.role}). ${what} you did not create needs edit access ` +
      `on this brand kit — you can still draft in your own.`,
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
  const restricted = uniqueIds.filter((id) => !approvableLibraryIds.has(id));
  if (restricted.length === 0) {
    return { unrestricted: true, approvableLibraryIds, ownRunIds: new Set() };
  }
  const caller = normalizeEmail(getRequestUserEmail());
  if (!caller) {
    return { unrestricted: false, approvableLibraryIds, ownRunIds: new Set() };
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
  return { unrestricted: false, approvableLibraryIds, ownRunIds };
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
