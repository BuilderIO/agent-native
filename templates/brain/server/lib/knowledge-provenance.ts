import { z } from "zod";

import type { schema } from "../db/index.js";

type KnowledgeRow = typeof schema.brainKnowledge.$inferSelect;

export type KnowledgeProvenanceMaterial = Pick<
  KnowledgeRow,
  | "title"
  | "body"
  | "summary"
  | "topic"
  | "tagsJson"
  | "entitiesJson"
  | "evidenceJson"
  | "confidence"
  | "kind"
  | "sourceId"
  | "captureId"
  | "audienceId"
>;

export type KnowledgeProvenanceRow = KnowledgeProvenanceMaterial &
  Pick<KnowledgeRow, "provenanceJson">;

export const KNOWLEDGE_PROVENANCE_VERSION = 1;

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const provenanceSchema = z
  .object({
    version: z.number().int(),
    revision: digestSchema,
    captures: z.array(
      z
        .object({ captureId: z.string().min(1), contentSha256: digestSchema })
        .strict(),
    ),
  })
  .strict();
const evidenceCaptureSchema = z.array(
  z.object({ captureId: z.string().min(1) }).passthrough(),
);

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function captureContentDigest(content: string) {
  return sha256(content);
}

export function knowledgeProvenanceRevision(row: KnowledgeProvenanceMaterial) {
  return sha256(
    JSON.stringify([
      "brain-knowledge-provenance",
      KNOWLEDGE_PROVENANCE_VERSION,
      row.title,
      row.body,
      row.summary,
      row.topic,
      row.tagsJson,
      row.entitiesJson,
      row.evidenceJson,
      row.confidence,
      row.kind,
      row.sourceId,
      row.captureId,
      row.audienceId,
    ]),
  );
}

export type EvidenceCaptureIds =
  | { readable: true; captureIds: string[] }
  | { readable: false };

export function evidenceCaptureIds(evidenceJson: string): EvidenceCaptureIds {
  let decoded: unknown;
  try {
    decoded = JSON.parse(evidenceJson);
  } catch {
    return { readable: false };
  }
  const parsed = evidenceCaptureSchema.safeParse(decoded);
  if (!parsed.success) return { readable: false };
  return {
    readable: true,
    captureIds: [...new Set(parsed.data.map((entry) => entry.captureId))],
  };
}

export function isEvidenceBackedKnowledge(
  row: Pick<KnowledgeRow, "captureId" | "evidenceJson" | "provenanceJson">,
) {
  if (row.captureId || row.provenanceJson !== null) return true;
  const evidence = evidenceCaptureIds(row.evidenceJson);
  return !evidence.readable || evidence.captureIds.length > 0;
}

export async function buildKnowledgeProvenance(
  row: KnowledgeProvenanceMaterial,
  validatedContent: ReadonlyMap<string, string>,
) {
  const evidence = evidenceCaptureIds(row.evidenceJson);
  if (!evidence.readable || !evidence.captureIds.length)
    throw new Error("Provenance requires readable, non-empty evidence.");
  const captures = [];
  for (const captureId of [...evidence.captureIds].sort()) {
    const content = validatedContent.get(captureId);
    if (content === undefined)
      throw new Error(
        `Provenance requires the validated content of capture ${captureId}.`,
      );
    captures.push({
      captureId,
      contentSha256: await captureContentDigest(content),
    });
  }
  return JSON.stringify({
    version: KNOWLEDGE_PROVENANCE_VERSION,
    revision: await knowledgeProvenanceRevision(row),
    captures,
  });
}

export type KnowledgeProvenanceFailure =
  | "missing"
  | "unreadable"
  | "unsupported-version"
  | "revision-mismatch"
  | "capture-set-mismatch"
  | "capture-unavailable"
  | "capture-content-mismatch";

export type KnowledgeProvenanceCheck =
  | { current: true }
  | { current: false; reason: KnowledgeProvenanceFailure };

const denied = (reason: KnowledgeProvenanceFailure) =>
  ({ current: false, reason }) as const;

export type CaptureDigestCache = Map<
  string,
  { content: string; digest: string }
>;

async function cachedCaptureDigest(
  captureId: string,
  content: string,
  cache: CaptureDigestCache | undefined,
) {
  const hit = cache?.get(captureId);
  if (hit && hit.content === content) return hit.digest;
  const digest = await captureContentDigest(content);
  cache?.set(captureId, { content, digest });
  return digest;
}

export async function checkKnowledgeProvenance(
  row: KnowledgeProvenanceRow,
  liveContent: ReadonlyMap<string, string>,
  digestCache?: CaptureDigestCache,
): Promise<KnowledgeProvenanceCheck> {
  if (row.provenanceJson === null) return denied("missing");
  let decoded: unknown;
  try {
    decoded = JSON.parse(row.provenanceJson);
  } catch {
    return denied("unreadable");
  }
  const parsed = provenanceSchema.safeParse(decoded);
  if (!parsed.success) return denied("unreadable");
  const provenance = parsed.data;
  if (provenance.version !== KNOWLEDGE_PROVENANCE_VERSION)
    return denied("unsupported-version");
  if (provenance.revision !== (await knowledgeProvenanceRevision(row)))
    return denied("revision-mismatch");

  const evidence = evidenceCaptureIds(row.evidenceJson);
  if (!evidence.readable || !evidence.captureIds.length)
    return denied("capture-set-mismatch");
  const bound = provenance.captures.map((entry) => entry.captureId);
  const required = new Set(evidence.captureIds);
  if (
    new Set(bound).size !== bound.length ||
    bound.length !== required.size ||
    !bound.every((captureId) => required.has(captureId)) ||
    row.captureId === null ||
    !required.has(row.captureId)
  )
    return denied("capture-set-mismatch");

  for (const entry of provenance.captures) {
    const content = liveContent.get(entry.captureId);
    if (content === undefined) return denied("capture-unavailable");
    if (
      (await cachedCaptureDigest(entry.captureId, content, digestCache)) !==
      entry.contentSha256
    )
      return denied("capture-content-mismatch");
  }
  return { current: true };
}
