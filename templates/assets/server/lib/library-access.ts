import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  assertAccess,
  ForbiddenError,
  roleSatisfies,
  type ShareRole,
} from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

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
