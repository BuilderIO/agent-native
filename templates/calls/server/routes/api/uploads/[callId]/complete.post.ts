/**
 * Explicit finalize endpoint for a chunked upload. The client normally sets
 * `isFinal=1` on the last chunk, but this route exists so a client can split
 * those two concerns — upload all chunks first, then call complete to trigger
 * finalize separately.
 *
 * Route: POST /api/uploads/:callId/complete
 * Body:  { durationMs?, width?, height?, mimeType? }
 */

import {
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";
import finalizeCall from "../../../../../actions/finalize-call.js";

interface CompleteBody {
  durationMs?: number;
  width?: number;
  height?: number;
  mimeType?: string;
}

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

  const body = (await readBody(event).catch(() => null)) as CompleteBody | null;

  try {
    const result = await finalizeCall.run({
      id: callId,
      durationMs:
        typeof body?.durationMs === "number" ? body.durationMs : undefined,
      width: typeof body?.width === "number" ? body.width : undefined,
      height: typeof body?.height === "number" ? body.height : undefined,
      mimeType:
        typeof body?.mimeType === "string" ? body.mimeType : undefined,
    });
    return { ok: true, finalized: true, ...result };
  } catch (err) {
    console.error("[calls] finalize-call failed:", err);
    const db = getDb();
    await db
      .update(schema.calls)
      .set({
        status: "failed",
        failureReason: err instanceof Error ? err.message : "Finalize failed",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.calls.id, callId));
    await writeAppState(`call-upload-${callId}`, {
      callId,
      status: "failed",
      failureReason: err instanceof Error ? err.message : "Finalize failed",
      updatedAt: new Date().toISOString(),
    });
    setResponseStatus(event, 500);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Finalize failed",
    };
  }
});
