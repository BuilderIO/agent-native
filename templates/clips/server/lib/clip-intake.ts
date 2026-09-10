import { verifyScopedAgentAccessToken } from "@agent-native/core/server";
import { and, eq, gt, inArray } from "drizzle-orm";
import { createError, getQuery, type H3Event } from "h3";

import {
  CLIP_INTAKE_RESOURCE_KIND,
  parseClipIntakeParams,
} from "../../shared/clip-intake.js";
import { getDb, schema } from "../db/index.js";

export type ClipIntakeSession = typeof schema.clipIntakeSessions.$inferSelect;

export interface ClipIntakeRequestContext {
  recordingId: string;
  ownerEmail: string;
  orgId: string;
}

function queryParams(event: H3Event): URLSearchParams {
  const query = getQuery(event);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined && first !== null) params.set(key, String(first));
  }
  return params;
}

function intakeIsExpired(
  session: ClipIntakeSession,
  now = Date.now(),
): boolean {
  const expiresAt = Date.parse(session.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export async function findClipIntakeSession(
  intakeId: string,
  token: string,
): Promise<ClipIntakeSession | null> {
  const verified = verifyScopedAgentAccessToken(token, {
    resourceKind: CLIP_INTAKE_RESOURCE_KIND,
    resourceId: intakeId,
  });
  if (!verified.ok) return null;

  const [session] = await getDb()
    .select()
    .from(schema.clipIntakeSessions)
    .where(eq(schema.clipIntakeSessions.id, intakeId))
    .limit(1);
  if (!session || intakeIsExpired(session)) return null;
  return session;
}

export async function requireClipIntakeSession(
  intakeId: string,
  token: string,
): Promise<ClipIntakeSession> {
  const session = await findClipIntakeSession(intakeId, token);
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: "Invalid or expired intake link",
    });
  }
  return session;
}

export async function resolveClipIntakeRequest(
  event: H3Event,
  recordingId: string,
): Promise<ClipIntakeRequestContext> {
  const params = parseClipIntakeParams(queryParams(event));
  if (!params) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  const session = await requireClipIntakeSession(params.intakeId, params.token);
  if (
    !session.recordingId ||
    session.recordingId !== recordingId ||
    !["recording", "completed"].includes(session.status)
  ) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  return {
    recordingId,
    ownerEmail: session.ownerEmail,
    orgId: session.organizationId,
  };
}

export async function claimClipIntakeRecording(
  intakeId: string,
  token: string,
): Promise<ClipIntakeSession | null> {
  const session = await findClipIntakeSession(intakeId, token);
  if (!session || session.status !== "open") return null;
  const [claimed] = await getDb()
    .update(schema.clipIntakeSessions)
    .set({ status: "creating", updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.clipIntakeSessions.id, intakeId),
        eq(schema.clipIntakeSessions.status, "open"),
        eq(schema.clipIntakeSessions.expiresAt, session.expiresAt),
        gt(schema.clipIntakeSessions.expiresAt, new Date().toISOString()),
      ),
    )
    .returning();
  return claimed ?? null;
}

export async function releaseClipIntakeCreation(
  intakeId: string,
): Promise<void> {
  await getDb()
    .update(schema.clipIntakeSessions)
    .set({ status: "open", updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.clipIntakeSessions.id, intakeId),
        eq(schema.clipIntakeSessions.status, "creating"),
      ),
    );
}

export async function attachClipIntakeRecording(
  intakeId: string,
  recordingId: string,
): Promise<void> {
  const [updated] = await getDb()
    .update(schema.clipIntakeSessions)
    .set({
      recordingId,
      status: "recording",
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.clipIntakeSessions.id, intakeId),
        eq(schema.clipIntakeSessions.status, "creating"),
      ),
    )
    .returning({ id: schema.clipIntakeSessions.id });
  if (!updated) throw new Error("Could not attach recording to intake session");
}

export async function completeClipIntake(
  intakeId: string,
  recordingId: string,
): Promise<void> {
  await getDb()
    .update(schema.clipIntakeSessions)
    .set({ status: "completed", updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.clipIntakeSessions.id, intakeId),
        eq(schema.clipIntakeSessions.recordingId, recordingId),
        inArray(schema.clipIntakeSessions.status, ["recording", "completed"]),
      ),
    );
}
