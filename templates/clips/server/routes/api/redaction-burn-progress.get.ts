/**
 * Progress of an in-flight redaction burn, for the editor's own poll.
 *
 * A route rather than an action: the burn is itself a long-running action, and
 * this has to answer while that one is still working. Owner-or-editor only,
 * and it says nothing but a percentage.
 *
 * **The session has to be put back on the call.** `resolveAccess` reads the
 * asker out of the framework's request context, and a plain nitro route does
 * not run inside one — the global auth middleware authenticates the request
 * but does not establish it. Without the wrapper below, `resolveAccess`
 * answered "no access" for the owner of the recording and every poll came back
 * 403, which the editor cannot tell from "still running": the bar sat at zero
 * and the page never learned the burn had finished, so a four-second burn
 * looked like an indefinite one. Found 2026-09-21 on production. This is the
 * same shape as `view-event.post.ts` and `thumbnail.post.ts`, which both wrap
 * their work this way.
 */

import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import { getBurnProgress } from "../../lib/redaction-burn-progress.js";

export default defineEventHandler(async (event) => {
  const { id } = getQuery(event) as { id?: string };
  if (!id || typeof id !== "string") {
    setResponseStatus(event, 400);
    return { error: "id is required" };
  }

  let session: Awaited<ReturnType<typeof getSession>> | null = null;
  try {
    session = await getSession(event);
  } catch (err) {
    // No session is an ordinary answer here — the 401 below is the same
    // either way — but a session *store* that is failing is not, and this is
    // the only place it would show.
    console.warn("[redaction-burn-progress] could not read the session", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const role = await runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      try {
        const access = await resolveAccess("recording", id);
        return access?.role ?? null;
      } catch (err) {
        // No access and a broken access check both end in a 403 below, but
        // only one of them is worth knowing about.
        console.warn("[redaction-burn-progress] access check failed", {
          id,
          err: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
  );
  if (!role || !["owner", "admin", "editor"].includes(role)) {
    setResponseStatus(event, 403);
    return { error: "Forbidden" };
  }

  return getBurnProgress(id);
});
