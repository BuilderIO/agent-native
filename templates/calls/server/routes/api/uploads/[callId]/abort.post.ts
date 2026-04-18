/**
 * Abort an in-flight call upload. Drops any stashed chunks from app-state
 * and marks the call row as failed.
 *
 * Route: POST /api/uploads/:callId/abort
 */

import {
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
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

  try {
    await assertAccess("call", callId, "editor");
  } catch {
    setResponseStatus(event, 403);
    return { error: "Forbidden" };
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
});
