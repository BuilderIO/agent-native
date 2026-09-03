import { readBody } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
// guard:allow-unscoped — signed public ingest must resolve the owning source
// from sourceKey + bearer token before it can establish request context.
import { and, eq, isNull, like, or } from "drizzle-orm";
import { createError, defineEventHandler, getHeader, type H3Event } from "h3";
import { z } from "zod";

import { getDb, schema } from "../../../../db/index.js";
import {
  BrainCaptureBlockedError,
  createCapture,
  parseJson,
  retireUpstreamDeletedCapture,
  serializeCapture,
  sha256Hex,
} from "../../../../lib/brain.js";
import { enqueueCaptureDistillation } from "../../../../lib/distillation-queue.js";
import { resolveMeetingMemberEmails } from "../../../../lib/meeting-audience.js";

const captureKindSchema = z.enum([
  "transcript",
  "note",
  "message",
  "document",
  "generic",
]);

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
    title: z.string().min(1).optional(),
    kind: captureKindSchema.optional(),
    content: z.string().optional(),
    participants: z.array(z.unknown()).default([]),
    capturedAt: z.string().optional(),
    occurredAt: z.string().optional(),
    transcript: z.string().optional(),
    segments: z.array(segmentSchema).optional(),
    sourceUrl: z.string().url().optional(),
    tags: z.array(z.string()).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
    raw: z.unknown().optional(),
    deleted: z.boolean().default(false),
  })
  .superRefine((payload, context) => {
    if (payload.deleted) return;
    if (!payload.title) {
      context.addIssue({
        code: "custom",
        message: "Provide title",
        path: ["title"],
      });
    }
    if (
      !payload.content?.trim() &&
      !payload.transcript?.trim() &&
      !payload.segments?.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Provide content, transcript, or segments",
        path: ["content"],
      });
    }
  });

function bearerToken(event: H3Event) {
  const header = getHeader(event, "authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ")
    ? header.slice("bearer ".length).trim()
    : "";
}

function textFromPayload(payload: z.infer<typeof rawCapturePayloadSchema>) {
  if (payload.content?.trim()) return payload.content.trim();
  if (payload.transcript?.trim()) return payload.transcript.trim();
  return (payload.segments ?? [])
    .map((segment) => {
      const prefix = segment.speaker ? `${segment.speaker}: ` : "";
      return `${prefix}${segment.text}`;
    })
    .join("\n")
    .trim();
}

function kindFromPayload(payload: z.infer<typeof rawCapturePayloadSchema>) {
  if (payload.kind) return payload.kind;
  if (payload.transcript?.trim() || payload.segments?.length) {
    return "transcript" as const;
  }
  return "generic" as const;
}

function metadataFromPayload(
  payload: z.infer<typeof rawCapturePayloadSchema>,
  kind: z.infer<typeof captureKindSchema>,
) {
  const metadata = {
    ...payload.metadata,
    sourceKey: payload.sourceKey,
    sourceUrl: payload.sourceUrl,
    tags: payload.tags,
  };
  if (kind !== "transcript") return metadata;
  return {
    ...metadata,
    participants: payload.participants,
    segments: payload.segments ?? [],
    raw: payload.raw,
  };
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
      if (payload.deleted) {
        const retired = await retireUpstreamDeletedCapture({
          sourceId: source.id,
          externalId: payload.externalId,
          provider: source.provider,
        });
        return {
          ok: true,
          sourceId: source.id,
          capture: null,
          deleted: true,
          retired,
        };
      }

      const kind = kindFromPayload(payload);
      const memberEmails = resolveMeetingMemberEmails(
        payload.participants,
        source.ownerEmail,
      );
      let capture;
      try {
        capture = await createCapture({
          sourceId: source.id,
          externalId: payload.externalId,
          title: payload.title!,
          kind,
          content: textFromPayload(payload),
          capturedAt: payload.capturedAt ?? payload.occurredAt,
          metadata: metadataFromPayload(payload, kind),
          audience:
            kind === "transcript"
              ? {
                  kind: "meeting",
                  memberEmails,
                  upstreamRefHash: payload.externalId,
                }
              : undefined,
        });
      } catch (error) {
        if (!(error instanceof BrainCaptureBlockedError)) throw error;
        return {
          ok: true,
          sourceId: source.id,
          capture: null,
          sensitivityReceipt: error.receipt,
        };
      }

      const distillation =
        capture.status === "distilled" || capture.status === "ignored"
          ? null
          : await enqueueCaptureDistillation({
              capture,
              priority: 50,
              payload: {
                sourceKey: payload.sourceKey,
                externalId: payload.externalId,
              },
            });

      return {
        ok: true,
        sourceId: source.id,
        capture: serializeCapture(capture),
        distillation: distillation
          ? {
              queued: true,
              queueId: distillation.queueItem.id,
              existing: distillation.existing,
            }
          : {
              queued: false,
              queueId: null,
              existing: false,
              reason: `already-${capture.status}`,
            },
      };
    },
  );
});
