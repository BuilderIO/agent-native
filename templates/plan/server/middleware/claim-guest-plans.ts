import { getSession } from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";
/**
 * Guest-plan claim middleware — the server half of "sign in to keep your work".
 *
 * Hosted unauthenticated visitors author plans under a stable guest identity
 * (`guest-<uuid>@agent-native.guest`, pinned by the httpOnly `plan_guest_author`
 * cookie — see lib/public-plans.ts). When such a visitor signs in, this
 * middleware transfers the plans they made as a guest onto their real account on
 * their first authenticated request that still carries the guest cookie, then
 * clears the cookie.
 *
 * Why middleware and not an action: the cookie is httpOnly (the client can't read
 * it) and an action's run() has no access to the request event, so the claim must
 * run where both the session and the cookie are available. It is secure by
 * construction — a caller can only ever claim the guest identity proven by their
 * own cookie.
 *
 * Cheap on the hot path: the guest cookie is absent for the vast majority of
 * requests (real users, and guests once claimed), so we bail before touching the
 * session or DB. The UPDATE is idempotent and scoped to the caller's own guest
 * identity, so concurrent requests and repeats are safe.
 */
import { defineEventHandler } from "h3";

import { getDb, schema } from "../db/index.js";
import {
  clearGuestAuthorCookie,
  isGuestAuthorIdentity,
  readGuestAuthorEmail,
} from "../lib/public-plans.js";

export default defineEventHandler(async (event) => {
  // Fast path: no guest cookie → nothing to claim. Covers real users and
  // already-claimed guests, i.e. almost every request.
  const guestEmail = readGuestAuthorEmail(event);
  if (!guestEmail) return;

  // Only claim onto a real authenticated account. Anonymous guests (no session)
  // keep their guest identity; synthetic guest/public identities never own a
  // real session, but guard anyway.
  const session = await getSession(event);
  const userEmail = session?.email;
  if (
    !userEmail ||
    isGuestAuthorIdentity(userEmail) ||
    userEmail === guestEmail
  ) {
    return;
  }

  try {
    // guard:allow-unscoped -- re-keys ONLY the caller's own guest-owned plans
    // (guest identity proven by their httpOnly cookie) onto their account.
    await getDb()
      .update(schema.plans)
      .set({ ownerEmail: userEmail })
      .where(
        and(
          eq(schema.plans.ownerEmail, guestEmail),
          isNull(schema.plans.orgId),
        ),
      );
    // Also re-key plan_versions so version history remains accessible after
    // the claim. All version actions filter by planVersions.ownerEmail, so
    // without this the claimed plan loses its entire version history.
    await getDb()
      .update(schema.planVersions)
      .set({ ownerEmail: userEmail })
      .where(eq(schema.planVersions.ownerEmail, guestEmail));
    // Drain complete (idempotent): stop pinning this visitor to the guest id.
    clearGuestAuthorCookie(event);
  } catch {
    // Best-effort: never break the request because a claim sweep failed. The
    // cookie stays, so the next authenticated request retries the claim.
  }
});
