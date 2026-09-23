import {
  runWithRequestContext,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { z } from "zod";

import { getDb, schema } from "../../../db/index.js";
import {
  CONTENT_TRASH_PURGE_TOKEN_KIND,
  processContentTrashPurge,
} from "../../../lib/content-trash-purge.js";

const bodySchema = z.object({
  operationId: z.string().uuid(),
  token: z.string().min(1),
});

export default defineEventHandler(async (event) => {
  let body: unknown;
  try {
    body = await readBody(event);
  } catch {
    setResponseStatus(event, 400);
    return { ok: false, error: "Unable to read Trash purge job" };
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    setResponseStatus(event, 400);
    return { ok: false, error: "Invalid Trash purge job" };
  }
  const { operationId, token } = parsed.data;
  const verified = verifyScopedAgentAccessToken(token, {
    resourceKind: CONTENT_TRASH_PURGE_TOKEN_KIND,
    resourceId: operationId,
  });
  if (!verified.ok) {
    setResponseStatus(event, 401);
    return { ok: false, error: "Invalid or expired Trash purge token" };
  }
  const [operation] = await getDb()
    .select({
      actorEmail: schema.contentTrashPurgeOperations.actorEmail,
      orgId: schema.contentTrashPurgeOperations.orgId,
    })
    .from(schema.contentTrashPurgeOperations)
    .where(eq(schema.contentTrashPurgeOperations.id, operationId))
    .limit(1);
  if (!operation) {
    setResponseStatus(event, 404);
    return { ok: false, error: "Trash purge operation not found" };
  }
  const result = await runWithRequestContext(
    { userEmail: operation.actorEmail, orgId: operation.orgId ?? undefined },
    () => processContentTrashPurge(operationId),
  );
  return { ok: true, operationId, result };
});
