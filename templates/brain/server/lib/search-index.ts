import { getDbExec, isPostgres } from "@agent-native/core/db";
import {
  availableEmbeddingFamilies,
  defaultEmbeddingFamily,
  type EmbeddingFamily,
} from "@agent-native/core/embeddings";
import {
  deletePgVectors,
  deletePostgresFtsDocuments,
  upsertPgVector,
  upsertPostgresFtsDocument,
} from "@agent-native/core/search";
import { completeText } from "@agent-native/core/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";
import { nanoid, nowIso } from "./brain.js";
import {
  BRAIN_SEARCH_INDEX_VERSION,
  BRAIN_SENSITIVITY_POLICY_VERSION,
  type BrainSearchStalenessKey,
} from "./search-index-contracts.js";

const artifactSchema = z.object({
  title: z.string().min(1).max(240),
  question: z.string().max(1_200).default(""),
  summary: z.string().max(2_400).default(""),
  resolution: z.string().max(2_400).default(""),
  systems: z.array(z.string().max(120)).max(24).default([]),
  codeRefs: z.array(z.string().max(240)).max(32).default([]),
});

const SEARCH_NAMESPACE = "brain";
export const BRAIN_BURST_SIZE = 850;
export const BRAIN_BURST_OVERLAP = 160;
export const BRAIN_MAX_EMBEDDED_BURSTS = 12;

export type BrainSearchArtifact = z.infer<typeof artifactSchema>;

export interface SearchIndexCapture {
  id: string;
  sourceId: string;
  title: string;
  content: string;
  contentHash: string | null;
  sensitivityDisposition: "pending" | "allowed";
  sensitivityPolicyVersion: string | null;
  audienceAclHash: string | null;
  capturedAt: string;
}

export interface SearchIndexAudience {
  audienceId: string;
  aclHash: string;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function indexStalenessKey(input: {
  contentHash: string;
  aclHash: string;
  indexVersion?: string;
  sensitivityPolicyVersion?: string;
}): BrainSearchStalenessKey {
  return {
    contentHash: input.contentHash,
    aclHash: input.aclHash,
    indexVersion: input.indexVersion ?? BRAIN_SEARCH_INDEX_VERSION,
    sensitivityPolicyVersion:
      input.sensitivityPolicyVersion ?? BRAIN_SENSITIVITY_POLICY_VERSION,
  };
}

export function canIndexCapture(capture: SearchIndexCapture): boolean {
  return (
    capture.sensitivityDisposition === "allowed" &&
    Boolean(capture.contentHash) &&
    Boolean(capture.audienceAclHash) &&
    Boolean(capture.sensitivityPolicyVersion)
  );
}

export function indexSnapshotMatches(
  current: SearchIndexCapture,
  expected: SearchIndexCapture,
  audienceAclHash: string,
): boolean {
  return (
    canIndexCapture(current) &&
    current.id === expected.id &&
    current.sourceId === expected.sourceId &&
    current.contentHash === expected.contentHash &&
    current.sensitivityPolicyVersion === expected.sensitivityPolicyVersion &&
    current.audienceAclHash === audienceAclHash
  );
}

async function currentIndexSnapshotMatches(
  capture: SearchIndexCapture,
  audience: SearchIndexAudience,
) {
  const [current] = await getDb()
    .select({
      id: schema.brainRawCaptures.id,
      sourceId: schema.brainRawCaptures.sourceId,
      title: schema.brainRawCaptures.title,
      content: schema.brainRawCaptures.content,
      contentHash: schema.brainRawCaptures.contentHash,
      sensitivityDisposition: schema.brainRawCaptures.sensitivityDisposition,
      sensitivityPolicyVersion:
        schema.brainRawCaptures.sensitivityPolicyVersion,
      audienceAclHash: schema.brainRawCaptures.audienceAclHash,
      capturedAt: schema.brainRawCaptures.capturedAt,
      assignmentAclHash: schema.brainCaptureAudiences.aclHash,
    })
    .from(schema.brainRawCaptures)
    .innerJoin(
      schema.brainCaptureAudiences,
      and(
        eq(schema.brainCaptureAudiences.captureId, schema.brainRawCaptures.id),
        eq(schema.brainCaptureAudiences.audienceId, audience.audienceId),
      ),
    )
    .where(eq(schema.brainRawCaptures.id, capture.id))
    .limit(1);
  return Boolean(
    current &&
    current.assignmentAclHash === audience.aclHash &&
    indexSnapshotMatches(
      current as SearchIndexCapture,
      capture,
      audience.aclHash,
    ),
  );
}

export function deterministicArtifact(input: {
  title: string;
  content: string;
}): BrainSearchArtifact {
  const content = normalize(input.content);
  const sentences = content.split(/(?<=[.!?])\s+/).filter(Boolean);
  const summary = sentences.slice(0, 3).join(" ").slice(0, 2_400);
  return {
    title:
      normalize(input.title) ||
      sentences[0]?.slice(0, 240) ||
      "Untitled capture",
    question: "",
    summary,
    resolution: sentences.slice(3, 6).join(" ").slice(0, 2_400),
    systems: [],
    codeRefs: [],
  };
}

function parseArtifact(value: string): BrainSearchArtifact | null {
  try {
    return artifactSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

/** Narrow, bounded extraction. Indexing still succeeds deterministically if no model is configured. */
export async function extractSearchArtifact(input: {
  title: string;
  content: string;
  complete?: typeof completeText;
}): Promise<BrainSearchArtifact> {
  const fallback = deterministicArtifact(input);
  const complete = input.complete ?? completeText;
  const prompt = `Return only JSON matching {title,question,summary,resolution,systems,codeRefs}. Do not include sensitive data or invent facts.\nTITLE: ${input.title}\nCONTENT: ${input.content.slice(0, 12_000)}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await complete({
        appId: "brain",
        input:
          attempt === 0
            ? prompt
            : `${prompt}\nPrevious output was invalid JSON. Return JSON only.`,
        maxOutputTokens: 900,
        temperature: 0,
        timeoutMs: 12_000,
      });
      const parsed = parseArtifact(result.text);
      if (parsed) return parsed;
    } catch {
      // A model is an optimization, never an indexing availability dependency.
    }
  }
  return fallback;
}

export function artifactText(artifact: BrainSearchArtifact): string {
  return [
    artifact.title,
    artifact.question,
    artifact.summary,
    artifact.resolution,
    ...artifact.systems,
    ...artifact.codeRefs,
  ]
    .map(normalize)
    .filter(Boolean)
    .join("\n");
}

export function burstText(
  content: string,
  size = 850,
  overlap = 160,
): string[] {
  return burstRows(content, size, overlap).map((burst) => burst.content);
}

export function burstRows(
  content: string,
  size = BRAIN_BURST_SIZE,
  overlap = BRAIN_BURST_OVERLAP,
) {
  if (!content.trim()) return [];
  const rows: Array<{
    content: string;
    startOffset: number;
    endOffset: number;
  }> = [];
  for (
    let startOffset = 0;
    startOffset < content.length;
    startOffset += Math.max(1, size - overlap)
  ) {
    const burstContent = content.slice(startOffset, startOffset + size);
    rows.push({
      content: burstContent,
      startOffset,
      endOffset: startOffset + burstContent.length,
    });
    if (startOffset + size >= content.length) break;
  }
  return rows;
}

async function configuredEmbeddingFamily(): Promise<EmbeddingFamily | null> {
  const families = await availableEmbeddingFamilies();
  return defaultEmbeddingFamily(families);
}

async function indexExternalSearchLanes(input: {
  artifactId: string;
  artifact: BrainSearchArtifact;
  artifactBody: string;
  burstIds: string[];
  burstBodies: string[];
  audienceId: string;
  sourceId: string;
  aclHash: string;
  contentHash: string;
  sensitivityPolicyVersion: string;
  indexVersion: string;
  now: string;
}) {
  const dbExec = getDbExec();
  await upsertPostgresFtsDocument(dbExec, {
    chunkId: input.artifactId,
    itemVersionId: input.contentHash,
    title: input.artifact.title,
    summary: input.artifact.summary,
    body: input.artifactBody,
    audienceIds: [input.audienceId],
    updatedAt: input.now,
    namespace: SEARCH_NAMESPACE,
  });
  const family = await configuredEmbeddingFamily();
  if (!family || !isPostgres()) return;
  const targets = [
    {
      targetType: "artifact" as const,
      targetId: input.artifactId,
      vectorKey: `artifact:${input.artifactId}`,
      text: input.artifactBody,
    },
    ...input.burstIds.slice(0, BRAIN_MAX_EMBEDDED_BURSTS).map((id, index) => ({
      targetType: "burst" as const,
      targetId: id,
      vectorKey: `burst:${id}`,
      text: input.burstBodies[index] ?? "",
    })),
  ].filter((target) => target.text.trim());
  const vectors = await family.embed(
    targets.map((target) => ({ text: target.text })),
    "document",
  );
  const db = getDb();
  for (const [index, target] of targets.entries()) {
    const vector = vectors[index];
    if (!vector) continue;
    await upsertPgVector(
      dbExec,
      {
        vectorKey: target.vectorKey,
        embeddingSetId: family.id,
        dimensions: family.dimensions,
        vector,
        audienceIds: [input.audienceId],
        updatedAt: input.now,
      },
      { namespace: SEARCH_NAMESPACE },
    );
    await db
      .insert(schema.brainSearchEmbeddings)
      .values({
        id: nanoid(),
        targetType: target.targetType,
        targetId: target.targetId,
        vectorKey: target.vectorKey,
        sourceId: input.sourceId,
        audienceId: input.audienceId,
        aclHash: input.aclHash,
        embeddingSetId: family.id,
        dimensions: family.dimensions,
        contentHash: input.contentHash,
        sensitivityPolicyVersion: input.sensitivityPolicyVersion,
        indexVersion: input.indexVersion,
        status: "active",
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [
          schema.brainSearchEmbeddings.embeddingSetId,
          schema.brainSearchEmbeddings.targetType,
          schema.brainSearchEmbeddings.targetId,
        ],
        set: {
          vectorKey: target.vectorKey,
          sourceId: input.sourceId,
          audienceId: input.audienceId,
          aclHash: input.aclHash,
          dimensions: family.dimensions,
          contentHash: input.contentHash,
          sensitivityPolicyVersion: input.sensitivityPolicyVersion,
          indexVersion: input.indexVersion,
          status: "active",
          updatedAt: input.now,
        },
      });
  }
}

async function retireExternalSearchLanesForArtifacts(
  artifactIds: string[],
  now: string,
) {
  if (!artifactIds.length) return;
  const db = getDb();
  const bursts = await db
    .select({ id: schema.brainSearchBursts.id })
    .from(schema.brainSearchBursts)
    .where(inArray(schema.brainSearchBursts.artifactId, artifactIds));
  const targetIds = [...artifactIds, ...bursts.map((burst) => burst.id)];
  const embeddings = await db
    .select({
      vectorKey: schema.brainSearchEmbeddings.vectorKey,
      dimensions: schema.brainSearchEmbeddings.dimensions,
    })
    .from(schema.brainSearchEmbeddings)
    .where(
      and(
        eq(schema.brainSearchEmbeddings.status, "active"),
        inArray(schema.brainSearchEmbeddings.targetId, targetIds),
      ),
    );
  await db
    .update(schema.brainSearchEmbeddings)
    .set({ status: "stale", updatedAt: now })
    .where(
      and(
        eq(schema.brainSearchEmbeddings.status, "active"),
        inArray(schema.brainSearchEmbeddings.targetId, targetIds),
      ),
    );
  if (!isPostgres()) return;
  try {
    await deletePostgresFtsDocuments(
      getDbExec(),
      artifactIds,
      SEARCH_NAMESPACE,
    );
  } catch {
    // Authoritative SQL metadata filters stale external candidates.
  }
  for (const dimensions of new Set(
    embeddings.map((embedding) => embedding.dimensions),
  )) {
    try {
      await deletePgVectors(
        getDbExec(),
        {
          dimensions,
          vectorKeys: embeddings
            .filter((embedding) => embedding.dimensions === dimensions)
            .map((embedding) => embedding.vectorKey),
          namespace: SEARCH_NAMESPACE,
        },
        true,
      );
    } catch {
      // Other dimensions and the FTS lane can still be cleaned independently.
    }
  }
}

/**
 * Writes only allowed captures with an explicit audience assignment. Callers own
 * enqueueing; this helper deliberately refuses pending/quarantined material.
 */
export async function indexCaptureForSearch(input: {
  capture: SearchIndexCapture;
  audience: SearchIndexAudience;
  artifact?: BrainSearchArtifact;
  id: string;
  now?: string;
}): Promise<{ indexed: boolean; reason?: string }> {
  if (!canIndexCapture(input.capture)) {
    return { indexed: false, reason: "capture-not-indexable" };
  }
  if (input.capture.audienceAclHash !== input.audience.aclHash) {
    return { indexed: false, reason: "audience-acl-mismatch" };
  }
  const artifact =
    input.artifact ?? (await extractSearchArtifact(input.capture));
  if (!(await currentIndexSnapshotMatches(input.capture, input.audience))) {
    return { indexed: false, reason: "stale-capture-snapshot" };
  }
  const now = input.now ?? new Date().toISOString();
  const key = indexStalenessKey({
    contentHash: input.capture.contentHash!,
    aclHash: input.audience.aclHash,
    sensitivityPolicyVersion: input.capture.sensitivityPolicyVersion!,
  });
  const db = getDb();
  const activeArtifacts = await db
    .select({ id: schema.brainSearchArtifacts.id })
    .from(schema.brainSearchArtifacts)
    .where(
      and(
        eq(schema.brainSearchArtifacts.captureId, input.capture.id),
        eq(schema.brainSearchArtifacts.status, "active"),
      ),
    );
  await db
    .update(schema.brainSearchArtifacts)
    .set({ status: "stale", updatedAt: now })
    .where(
      and(
        eq(schema.brainSearchArtifacts.captureId, input.capture.id),
        eq(schema.brainSearchArtifacts.status, "active"),
      ),
    );
  await retireExternalSearchLanesForArtifacts(
    activeArtifacts.map((artifact) => artifact.id),
    now,
  );
  await db
    .insert(schema.brainSearchArtifacts)
    .values({
      id: input.id,
      captureId: input.capture.id,
      sourceId: input.capture.sourceId,
      audienceId: input.audience.audienceId,
      aclHash: key.aclHash,
      title: artifact.title,
      question: artifact.question,
      summary: artifact.summary,
      resolution: artifact.resolution,
      systemsJson: JSON.stringify(artifact.systems),
      codeRefsJson: JSON.stringify(artifact.codeRefs),
      contentHash: key.contentHash,
      sensitivityPolicyVersion: key.sensitivityPolicyVersion,
      indexVersion: key.indexVersion,
      status: "active",
      capturedAt: input.capture.capturedAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.brainSearchArtifacts.captureId,
        schema.brainSearchArtifacts.contentHash,
        schema.brainSearchArtifacts.indexVersion,
      ],
      set: {
        sourceId: input.capture.sourceId,
        audienceId: input.audience.audienceId,
        aclHash: key.aclHash,
        title: artifact.title,
        question: artifact.question,
        summary: artifact.summary,
        resolution: artifact.resolution,
        systemsJson: JSON.stringify(artifact.systems),
        codeRefsJson: JSON.stringify(artifact.codeRefs),
        sensitivityPolicyVersion: key.sensitivityPolicyVersion,
        status: "active",
        capturedAt: input.capture.capturedAt,
        updatedAt: now,
      },
    });
  const [storedArtifact] = await db
    .select({ id: schema.brainSearchArtifacts.id })
    .from(schema.brainSearchArtifacts)
    .where(
      and(
        eq(schema.brainSearchArtifacts.captureId, input.capture.id),
        eq(schema.brainSearchArtifacts.contentHash, key.contentHash),
        eq(schema.brainSearchArtifacts.indexVersion, key.indexVersion),
      ),
    )
    .limit(1);
  if (!storedArtifact)
    return { indexed: false, reason: "artifact-write-failed" };
  const bursts = burstRows(input.capture.content);
  const burstIds: string[] = [];
  const burstBodies: string[] = [];
  for (const [ordinal, burst] of bursts.entries()) {
    const burstId = `${storedArtifact.id}:b${ordinal}`;
    const contextualText = [artifactText(artifact), burst.content]
      .filter(Boolean)
      .join("\n");
    await db
      .insert(schema.brainSearchBursts)
      .values({
        id: burstId,
        artifactId: storedArtifact.id,
        captureId: input.capture.id,
        sourceId: input.capture.sourceId,
        audienceId: input.audience.audienceId,
        aclHash: key.aclHash,
        ordinal,
        startOffset: burst.startOffset,
        endOffset: burst.endOffset,
        content: burst.content,
        contextualText,
        charCount: burst.content.length,
        rareTermScore: 0,
        reactionCount: 0,
        indexed: ordinal < BRAIN_MAX_EMBEDDED_BURSTS ? 1 : 0,
        contentHash: key.contentHash,
        indexVersion: key.indexVersion,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.brainSearchBursts.captureId,
          schema.brainSearchBursts.contentHash,
          schema.brainSearchBursts.indexVersion,
          schema.brainSearchBursts.ordinal,
        ],
        set: {
          artifactId: storedArtifact.id,
          sourceId: input.capture.sourceId,
          audienceId: input.audience.audienceId,
          aclHash: key.aclHash,
          startOffset: burst.startOffset,
          endOffset: burst.endOffset,
          content: burst.content,
          contextualText,
          charCount: burst.content.length,
          indexed: ordinal < BRAIN_MAX_EMBEDDED_BURSTS ? 1 : 0,
          updatedAt: now,
        },
      });
    burstIds.push(burstId);
    burstBodies.push(contextualText);
  }
  try {
    await indexExternalSearchLanes({
      artifactId: storedArtifact.id,
      artifact,
      artifactBody: artifactText(artifact),
      burstIds,
      burstBodies,
      audienceId: input.audience.audienceId,
      sourceId: input.capture.sourceId,
      aclHash: key.aclHash,
      contentHash: key.contentHash,
      sensitivityPolicyVersion: key.sensitivityPolicyVersion,
      indexVersion: key.indexVersion,
      now,
    });
  } catch {
    // SQL artifacts remain searchable when an optional external lane is unavailable.
  }
  if (!(await currentIndexSnapshotMatches(input.capture, input.audience))) {
    const staleAt = nowIso();
    await db
      .update(schema.brainSearchArtifacts)
      .set({ status: "stale", updatedAt: staleAt })
      .where(eq(schema.brainSearchArtifacts.id, storedArtifact.id));
    await retireExternalSearchLanesForArtifacts([storedArtifact.id], staleAt);
    return { indexed: false, reason: "stale-capture-snapshot" };
  }
  return { indexed: true };
}

/** Queue-worker entrypoint. A capture without an active audience is deliberately not searchable. */
export async function indexBrainCapture(captureId: string): Promise<{
  indexed: number;
  reason?: string;
}> {
  const db = getDb();
  const [capture] = await db
    .select()
    .from(schema.brainRawCaptures)
    .where(eq(schema.brainRawCaptures.id, captureId))
    .limit(1);
  if (!capture || capture.sensitivityDisposition !== "allowed") {
    await unindexBrainCapture(captureId);
    return { indexed: 0, reason: "capture-not-allowed" };
  }
  const audiences = await db
    .select({
      audienceId: schema.brainCaptureAudiences.audienceId,
      aclHash: schema.brainCaptureAudiences.aclHash,
    })
    .from(schema.brainCaptureAudiences)
    .where(eq(schema.brainCaptureAudiences.captureId, captureId));
  let indexed = 0;
  for (const audience of audiences) {
    const result = await indexCaptureForSearch({
      capture: {
        ...capture,
        sensitivityDisposition: capture.sensitivityDisposition,
      },
      audience,
      id: nanoid(),
      now: nowIso(),
    });
    if (result.indexed) indexed += 1;
  }
  return indexed ? { indexed } : { indexed: 0, reason: "no-active-audience" };
}

export async function unindexBrainCapture(captureId: string): Promise<void> {
  const now = nowIso();
  const db = getDb();
  const artifacts = await db
    .select({ id: schema.brainSearchArtifacts.id })
    .from(schema.brainSearchArtifacts)
    .where(eq(schema.brainSearchArtifacts.captureId, captureId));
  const bursts = await db
    .select({ id: schema.brainSearchBursts.id })
    .from(schema.brainSearchBursts)
    .where(eq(schema.brainSearchBursts.captureId, captureId));
  const targetIds = [
    ...artifacts.map((artifact) => artifact.id),
    ...bursts.map((burst) => burst.id),
  ];
  const embeddings = targetIds.length
    ? await db
        .select({
          vectorKey: schema.brainSearchEmbeddings.vectorKey,
          dimensions: schema.brainSearchEmbeddings.dimensions,
        })
        .from(schema.brainSearchEmbeddings)
        .where(
          and(
            eq(schema.brainSearchEmbeddings.status, "active"),
            inArray(schema.brainSearchEmbeddings.targetId, targetIds),
          ),
        )
    : [];
  await db
    .update(schema.brainSearchArtifacts)
    .set({ status: "deleted", updatedAt: now })
    .where(eq(schema.brainSearchArtifacts.captureId, captureId));
  await db
    .update(schema.brainSearchEmbeddings)
    .set({ status: "deleted", updatedAt: now })
    .where(inArray(schema.brainSearchEmbeddings.targetId, targetIds));
  if (!isPostgres()) return;
  try {
    await deletePostgresFtsDocuments(
      getDbExec(),
      artifacts.map((artifact) => artifact.id),
      SEARCH_NAMESPACE,
    );
    for (const dimensions of new Set(
      embeddings.map((embedding) => embedding.dimensions),
    )) {
      await deletePgVectors(
        getDbExec(),
        {
          dimensions,
          vectorKeys: embeddings
            .filter((embedding) => embedding.dimensions === dimensions)
            .map((embedding) => embedding.vectorKey),
          namespace: SEARCH_NAMESPACE,
        },
        true,
      );
    }
  } catch {
    // Metadata status is authoritative; optional Postgres lanes can be swept later.
  }
}
