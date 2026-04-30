/**
 * Abort an in-flight call upload. Drops any stashed chunks from app-state
 * and marks the call row as failed.
 *
 * Route: POST /api/uploads/:callId/abort
 *
 * Auth: requires an authenticated session AND `editor` access on the call.
 * The callId comes from the URL — without re-asserting access here a guesser
 * could wipe another tenant's in-flight upload. Each chunk/abort/complete
 * request is independent on serverless so the check has to happen on every
 * request, not once at upload-start.
 */

import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db/index.js";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import {
  deleteAppState,
  deleteAppStateByPrefix,
  writeAppState,
} from "@agent-native/core/application-state";

export default defineEventHandler(async (event: H3Event) => {
  const callId = getRouterParam(event, "callId");
  if (!callId) {
    setResponseStatus(event, 400);
    return { error: "Missing callId" };
  }

  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      try {
        await assertAccess("call", callId, "editor");
      } catch (err) {
        if (err instanceof ForbiddenError) {
          setResponseStatus(event, 403);
          return { error: "Forbidden" };
        }
        throw err;
      }

      const db = getDb();
      const cleared = await deleteAppStateByPrefix(`call-chunks-${callId}-`);
      await deleteAppState(`call-upload-${callId}`);

      const now = new Date().toISOString();
      await db
        .update(schema.calls)
        .set({
          status: "failed",
          failureReason: "upload aborted",
          updatedAt: now,
        })
        .where(eq(schema.calls.id, callId));

      await writeAppState("refresh-signal", { ts: Date.now() });

      return { ok: true, callId, chunksCleared: cleared };
    },
  );
});
