import { readBody } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
// guard:allow-unscoped — signed public ingest must resolve the owning source
// from sourceKey + bearer token before it can establish request context.
import { and, eq, isNull, like, or } from "drizzle-orm";
import { createError, defineEventHandler, getHeader, type H3Event } from "h3";
import { z } from "zod";

import { getDb, schema } from "../../../../db/index.js";
import {
  createCapture,
  parseJson,
  serializeCapture,
  sha256Hex,
} from "../../../../lib/brain.js";

const segmentSchema = z
  .object({
    startMs: z.coerce.number().int().min(0).optional(),
    endMs: z.coerce.number().int().min(0).optional(),
    text: z.string().min(1),
    speaker: z.string().optional(),
  })
  .passthrough();

const rawCapturePayloadSchema = z
  .object({
    sourceKey: z.string().min(1),
    externalId: z.string().min(1),
    title: z.string().min(1),
    participants: z.array(z.unknown()).default([]),
    occurredAt: z.string().optional(),
    transcript: z.string().optional(),
    segments: z.array(segmentSchema).optional(),
    sourceUrl: z.string().url().optional(),
    tags: z.array(z.string()).default([]),
    raw: z.unknown().optional(),
  })
  .refine((payload) => payload.transcript?.trim() || payload.segments?.length, {
    message: "Provide transcript or segments",
  });

function bearerToken(event: H3Event) {
  const header = getHeader(event, "authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ")
    ? header.slice("bearer ".length).trim()
    : "";
}

function textFromPayload(payload: z.infer<typeof rawCapturePayloadSchema>) {
  if (payload.transcript?.trim()) return payload.transcript.trim();
  return (payload.segments ?? [])
    .map((segment) => {
      const prefix = segment.speaker ? `${segment.speaker}: ` : "";
      return `${prefix}${segment.text}`;
    })
    .join("\n")
    .trim();
}

function sourceKeyConfigPattern(sourceKey: string) {
  return `%"sourceKey":${JSON.stringify(sourceKey)}%`;
}

export default defineEventHandler(async (event) => {
  const payload = rawCapturePayloadSchema.parse(await readBody(event));
  const token = bearerToken(event);
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: "Missing token" });
  }

  const tokenHash = await sha256Hex(token);
  const sources = await getDb()
    .select()
    .from(schema.brainSources)
    .where(
      and(
        eq(schema.brainSources.status, "active"),
        or(
          and(
            eq(schema.brainSources.sourceKey, payload.sourceKey),
            eq(schema.brainSources.ingestTokenHash, tokenHash),
          ),
          and(
            isNull(schema.brainSources.sourceKey),
            isNull(schema.brainSources.ingestTokenHash),
            like(
              schema.brainSources.configJson,
              sourceKeyConfigPattern(payload.sourceKey),
            ),
          ),
        ),
      ),
    );
  const source = sources.find((row) => {
    const config = parseJson<Record<string, unknown>>(row.configJson, {});
    return (
      config.sourceKey === payload.sourceKey &&
      config.ingestTokenHash === tokenHash
    );
  });

  if (!source) {
    throw createError({ statusCode: 404, statusMessage: "Unknown source" });
  }

  return runWithRequestContext(
    {
      userEmail: source.ownerEmail,
      orgId: source.orgId ?? undefined,
    },
    async () => {
      const capture = await createCapture({
        sourceId: source.id,
        externalId: payload.externalId,
        title: payload.title,
        kind: "transcript",
        content: textFromPayload(payload),
        capturedAt: payload.occurredAt,
        metadata: {
          sourceKey: payload.sourceKey,
          participants: payload.participants,
          segments: payload.segments ?? [],
          sourceUrl: payload.sourceUrl,
          tags: payload.tags,
          raw: payload.raw,
        },
      });

      return {
        ok: true,
        sourceId: source.id,
        capture: serializeCapture(capture),
      };
    },
  );
});
