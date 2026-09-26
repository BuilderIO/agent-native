
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
