import { fail } from "@agent-native/core/action";
import {
  LOCALIZATION_SETTING_KEY,
  normalizeLocalizationPreference,
  normalizeTimezonePreference,
} from "@agent-native/core/localization";
import {
  changedRowCount,
  countSaveOutcome,
  saveConflict,
} from "@agent-native/core/save-conflict/server";
import { formatDateInTimezone } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestTimezone,
} from "@agent-native/core/server/request-context";
import { getUserSetting } from "@agent-native/core/settings";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
  ilike,
} from "drizzle-orm";
import { z } from "zod";

import {
  intelligenceEntitySchema,
  intelligenceKindSchema,
  intelligenceStatusSchema,
  ownershipConfidenceSchema,
  type IntelligenceItem,
} from "../../shared/intelligence.js";
import type {
  BrainEvidence,
  BrainEvidenceInput,
  BrainPublishTier,
} from "../../shared/types.js";
import { getDb, schema } from "../db/index.js";
import { listAccessibleAudienceIds } from "./audiences.js";
import {
  assertDerivedAudienceAccess,
  decideKnowledgeSave,
  firstRow,
  getAccessibleCapture,
  knowledgeRevision,
  knowledgeWriteIsStored,
  lockKnowledgeWriteSet,
  runAfterCommitEffects,
  transactWithResourceStore,
  type AfterCommitEffects,
  nowIso,
  postCommitWarnings,
  searchKnowledgePage,
  serializeKnowledge,
  sha256Hex,
  touchKnowledgeRevision,
  validateEvidence,
  type WriteKnowledgeInput,
  writeKnowledgeRecordInTransaction,
} from "./brain.js";
import {
  checkKnowledgeProvenance,
  type CaptureDigestCache,
  evidenceCaptureIds,
  isEvidenceBackedKnowledge,
} from "./knowledge-provenance.js";
import { personalGoogleSourceFilter } from "./source-access.js";

type KnowledgeRow = typeof schema.brainKnowledge.$inferSelect;
type DetailRow = typeof schema.brainKnowledgeIntelligence.$inferSelect;
type VerificationRow = typeof schema.brainKnowledgeVerifications.$inferSelect;
const snapshotSchema = z.array(
  z.object({ captureId: z.string(), contentHash: z.string() }),
);
const evidenceQuoteSchema = z.array(
  z.object({
    captureId: z.string().min(1),
    quote: z.string().refine((value) => value.trim().length > 0),
  }),
);

function requireEmail() {
  const email = getRequestUserEmail()?.trim().toLowerCase();
  if (!email)
    fail("Sign in to use Brain intelligence.", {
      errorCode: "not_authenticated",
      statusCode: 401,
    });
  return email;
}

export function knowledgeContentRevision(
  row: Pick<
    KnowledgeRow,
    | "title"
    | "body"
    | "summary"
    | "entitiesJson"
    | "evidenceJson"
    | "confidence"
    | "sourceId"
    | "captureId"
    | "audienceId"
  >,
) {
  return sha256Hex(
    JSON.stringify({
      title: row.title,
      body: row.body,
      summary: row.summary,
      entities: row.entitiesJson,
      evidence: row.evidenceJson,
      confidence: row.confidence,
      sourceId: row.sourceId,
      captureId: row.captureId,
      audienceId: row.audienceId,
    }),
  );
}

async function loadCurrentEvidence(
  evidence: Array<Pick<BrainEvidence, "captureId">>,
) {
  if (!evidence.length)
    return new Map<
      string,
      { id: string; content: string; contentHash: string | null }
    >();
  const audiences = await listAccessibleAudienceIds();
  if (!audiences.length)
    return new Map<
      string,
      { id: string; content: string; contentHash: string | null }
    >();
  const captureIds = [...new Set(evidence.map((item) => item.captureId))];
  const captures = await getDb()
    .selectDistinct({
      id: schema.brainRawCaptures.id,
      content: schema.brainRawCaptures.content,
      contentHash: schema.brainRawCaptures.contentHash,
    })
    .from(schema.brainRawCaptures)
    .innerJoin(
      schema.brainSources,
      eq(schema.brainSources.id, schema.brainRawCaptures.sourceId),
    )
    .innerJoin(
      schema.brainCaptureAudiences,
      eq(schema.brainCaptureAudiences.captureId, schema.brainRawCaptures.id),
    )
    .where(
      and(
        inArray(schema.brainRawCaptures.id, captureIds),
        eq(schema.brainRawCaptures.sensitivityDisposition, "allowed"),
        inArray(schema.brainCaptureAudiences.audienceId, audiences),
        and(
          accessFilter(schema.brainSources, schema.brainSourceShares),
          personalGoogleSourceFilter(),
        ),
      ),
    )
    .limit(captureIds.length);
  return new Map(captures.map((capture) => [capture.id, capture]));
}

async function currentEvidence(
  evidence: Array<Pick<BrainEvidence, "captureId" | "quote">>,
  snapshots?: z.infer<typeof snapshotSchema>,
  loaded?: Awaited<ReturnType<typeof loadCurrentEvidence>>,
) {
  if (!evidence.length) return false;
  const byId = loaded ?? (await loadCurrentEvidence(evidence));
  for (const item of evidence) {
    const capture = byId.get(item.captureId);
    if (!capture || !capture.content.includes(item.quote)) return false;
    if (snapshots) {
      const snapshot = snapshots.find(
        (entry) => entry.captureId === item.captureId,
      );
      const hash = capture.contentHash ?? (await sha256Hex(capture.content));
      if (!snapshot || snapshot.contentHash !== hash) return false;
    }
  }
  return true;
}

async function ordinaryKnowledgeIsCurrent(
  row: KnowledgeRow,
  loaded: Awaited<ReturnType<typeof loadCurrentEvidence>>,
  digestCache: CaptureDigestCache,
) {
  const cited = evidenceCaptureIds(row.evidenceJson);
  const captureIds = new Set(cited.readable ? cited.captureIds : []);
  if (row.captureId) captureIds.add(row.captureId);
  const liveContent = new Map<string, string>();
  for (const captureId of captureIds) {
    const capture = loaded.get(captureId);
    if (capture) liveContent.set(captureId, capture.content);
  }
  return (await checkKnowledgeProvenance(row, liveContent, digestCache))
    .current;
}

async function intelligenceRevision(row: KnowledgeRow, detail: DetailRow) {
  return sha256Hex(
    JSON.stringify([
      await knowledgeContentRevision(row),
      detail.kind,
      detail.owner,
      detail.dueDate,
      detail.taskStatus,
      detail.ownershipConfidence,
      detail.updatedAt,
    ]),
  );
}

function verificationFor(
  row: VerificationRow | null | undefined,
  revision: string,
) {
  if (!row || row.knowledgeRevision !== revision) {
    return {
      state: "unverified" as const,
      verifiedBy: null,
      verifiedAt: null,
      remindAt: null,
    };
  }
  const state = z
    .enum(["verified", "deprecated", "unverified"])
    .parse(row.state);
  return {
    state,
    verifiedBy: row.actorEmail,
    verifiedAt: row.actedAt,
    remindAt: state === "verified" ? (row.remindAt ?? null) : null,
  };
}

async function itemFromRows(
  row: KnowledgeRow,
  detail: DetailRow,
  verification: VerificationRow | null | undefined,
  loaded?: Awaited<ReturnType<typeof loadCurrentEvidence>>,
): Promise<IntelligenceItem | null> {
  const revision = await knowledgeContentRevision(row);
  if (revision !== detail.knowledgeRevision || !row.audienceId) return null;
  const knowledge = serializeKnowledge(row);
  const snapshots = snapshotSchema.parse(
    JSON.parse(detail.evidenceSnapshotsJson),
  );
  if (!(await currentEvidence(knowledge.evidence, snapshots, loaded)))
    return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    kind: intelligenceKindSchema.parse(detail.kind),
    owner: detail.owner,
    dueDate: detail.dueDate,
    status: intelligenceStatusSchema.parse(detail.taskStatus),
    ownershipConfidence: ownershipConfidenceSchema.parse(
      detail.ownershipConfidence,
    ),
    confidence: row.confidence,
    entities: z.array(intelligenceEntitySchema).parse(knowledge.entities),
    evidence: knowledge.evidence,
    audienceId: row.audienceId,
    updatedAt: detail.updatedAt,
    revision: knowledgeRevision(row),
    verification: verificationFor(
      verification,
      await intelligenceRevision(row, detail),
    ),
  };
}

export interface IntelligenceFilter {
  id?: string | undefined;
  captureId?: string | undefined;
  kind?: IntelligenceItem["kind"] | undefined;
  status?: IntelligenceItem["status"] | undefined;
  owner?: string | undefined;
  includeUnowned?: boolean | undefined;
  query?: string | undefined;
  limit?: number | undefined;
  priorityThrough?: string | undefined;
}

export async function listIntelligence(input: IntelligenceFilter = {}) {
  requireEmail();
  const limit = Math.min(input.limit ?? 50, 100);
  const query = input.query?.trim();
  const audienceIds = await listAccessibleAudienceIds();
  if (!audienceIds.length)
    return { records: [], count: 0, hasMore: false, scanLimited: false };
  const records: IntelligenceItem[] = [];
  const maximumCandidates = 1_000;
  let scanned = 0;
  let scanLimited = false;
  let cursor: DetailRow | undefined;
  while (scanned < maximumCandidates && records.length <= limit) {
    const batchSize = Math.min(100, maximumCandidates - scanned);
    const older = cursor
      ? or(
          lt(schema.brainKnowledgeIntelligence.updatedAt, cursor.updatedAt),
          and(
            eq(schema.brainKnowledgeIntelligence.updatedAt, cursor.updatedAt),
            lt(
              schema.brainKnowledgeIntelligence.knowledgeId,
              cursor.knowledgeId,
            ),
          ),
        )
      : undefined;
    const after =
      cursor && input.priorityThrough
        ? cursor.dueDate === null
          ? and(isNull(schema.brainKnowledgeIntelligence.dueDate), older)
          : or(
              gt(schema.brainKnowledgeIntelligence.dueDate, cursor.dueDate),
              isNull(schema.brainKnowledgeIntelligence.dueDate),
              and(
                eq(schema.brainKnowledgeIntelligence.dueDate, cursor.dueDate),
                older,
              ),
            )
        : older;
    const rows = await getDb()
      .select({
        knowledge: schema.brainKnowledge,
        detail: schema.brainKnowledgeIntelligence,
        verification: schema.brainKnowledgeVerifications,
      })
      .from(schema.brainKnowledgeIntelligence)
      .innerJoin(
        schema.brainKnowledge,
        eq(
          schema.brainKnowledge.id,
          schema.brainKnowledgeIntelligence.knowledgeId,
        ),
      )
      .leftJoin(
        schema.brainKnowledgeVerifications,
        eq(
          schema.brainKnowledgeVerifications.knowledgeId,
          schema.brainKnowledge.id,
        ),
      )
      .where(
        and(
          after,
          accessFilter(schema.brainKnowledge, schema.brainKnowledgeShares),
          inArray(schema.brainKnowledge.audienceId, audienceIds),
          or(
            eq(schema.brainKnowledge.status, "published"),
            eq(schema.brainKnowledge.status, "draft"),
          ),
          input.id ? eq(schema.brainKnowledge.id, input.id) : undefined,
          input.captureId
            ? sql`exists (select 1 from jsonb_array_elements(${schema.brainKnowledge.evidenceJson}::jsonb) as evidence where evidence->>'captureId' = ${input.captureId})`
            : undefined,
          input.kind
            ? eq(schema.brainKnowledgeIntelligence.kind, input.kind)
            : undefined,
          input.status
            ? eq(schema.brainKnowledgeIntelligence.taskStatus, input.status)
            : undefined,
          input.priorityThrough
            ? and(
                or(
                  sql`${schema.brainKnowledgeIntelligence.dueDate} IS NULL`,
                  sql`${schema.brainKnowledgeIntelligence.dueDate} <= ${input.priorityThrough}`,
                ),
                or(
                  sql`${schema.brainKnowledgeVerifications.state} IS NULL`,
                  sql`${schema.brainKnowledgeVerifications.state} <> 'deprecated'`,
                ),
              )
            : undefined,
          input.owner
            ? or(
                sql`lower(${schema.brainKnowledgeIntelligence.owner}) = ${input.owner.toLowerCase()}`,
                input.includeUnowned
                  ? sql`${schema.brainKnowledgeIntelligence.owner} IS NULL`
                  : undefined,
              )
            : undefined,
          query
            ? or(
                ilike(schema.brainKnowledge.title, `%${query}%`),
                ilike(schema.brainKnowledge.body, `%${query}%`),
                ilike(schema.brainKnowledgeIntelligence.owner, `%${query}%`),
              )
            : undefined,
        ),
      )
      .orderBy(
        ...(input.priorityThrough
          ? [sql`${schema.brainKnowledgeIntelligence.dueDate} ASC NULLS LAST`]
          : []),
        desc(schema.brainKnowledgeIntelligence.updatedAt),
        desc(schema.brainKnowledgeIntelligence.knowledgeId),
      )
      .limit(batchSize);
    scanned += rows.length;
    const loaded = await loadCurrentEvidence(
      rows.flatMap((row) => serializeKnowledge(row.knowledge).evidence),
    );
    for (const row of rows) {
      const item = await itemFromRows(
        row.knowledge,
        row.detail,
        row.verification,
        loaded,
      );
      if (!item) continue;
      const normalizedQuery = query?.toLowerCase();
      if (
        normalizedQuery &&
        !`${item.title} ${item.body} ${item.owner ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery)
      )
        continue;
      records.push(item);
      if (records.length > limit) break;
    }
    const last = rows.find((_row, index) => index === rows.length - 1);
    if (!last || rows.length < batchSize || records.length > limit) break;
    cursor = last.detail;
    if (scanned >= maximumCandidates) scanLimited = true;
  }
  return {
    records: records.slice(0, limit),
    count: Math.min(records.length, limit),
    hasMore: scanLimited || records.length > limit,
    scanLimited,
  };
}

function hasDistinctMention(quote: string, name: string): boolean {
  const escaped = name
    .trim()
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = "\\p{L}\\p{N}\\p{M}_@";
  return new RegExp(
    `(?:^|[^${word}.+%\\-])${escaped}(?=$|[^${word}.+%\\-]|[.+%\\-](?![${word}]))`,
    "u",
  ).test(quote);
}

export interface WriteIntelligenceInput {
  id?: string | undefined;
  expectedRevision?: string | undefined;
  kind: IntelligenceItem["kind"];
  title: string;
  body: string;
  owner?: string | null | undefined;
  dueDate?: string | null | undefined;
  status: IntelligenceItem["status"];
  ownershipConfidence: IntelligenceItem["ownershipConfidence"];
  confidence: number;
  entities: IntelligenceItem["entities"];
  evidence: BrainEvidenceInput[];
  publishTier?: BrainPublishTier | undefined;
}

export async function writeIntelligence(input: WriteIntelligenceInput) {
  requireEmail();
  const { value: result, effects } = await transactWithResourceStore(
    getDb(),
    false,
    async (_scoped, effects) => writeIntelligenceLocked(input, effects),
  );
  return {
    ...result,
    ...postCommitWarnings(await runAfterCommitEffects(effects)),
  };
}

function knowledgeInputForIntelligence(
  input: WriteIntelligenceInput,
): WriteKnowledgeInput {
  const publishTier = input.publishTier ?? (input.id ? undefined : "private");
  return {
    ...(input.id
      ? { knowledgeId: input.id, expectedRevision: input.expectedRevision }
      : {}),
    kind: input.kind === "decision" ? "decision" : "open-question",
    title: input.title,
    body: input.body,
    summary: "",
    entities: input.entities,
    evidence: input.evidence,
    confidence: input.confidence,
    ...(publishTier ? { publishTier } : {}),
  };
}

function intelligenceDetailFields(input: WriteIntelligenceInput) {
  return {
    kind: input.kind,
    owner: input.owner?.trim() || null,
    dueDate: input.dueDate ?? null,
    taskStatus: input.status,
    ownershipConfidence: input.ownershipConfidence,
  };
}

function assertIntelligenceGrounded(
  input: WriteIntelligenceInput,
  evidence: BrainEvidence[],
) {
  if (!evidence.length)
    fail("At least one exact evidence quote is required.", {
      errorCode: "evidence_required",
      statusCode: 400,
    });
  const quotes = evidence
    .map((entry) => entry.quote)
    .join("\n")
    .toLowerCase();
  for (const entity of input.entities) {
    if (!hasDistinctMention(quotes, entity.name))
      fail("Every entity must occur in the evidence quotes.", {
        errorCode: "entity_not_in_evidence",
        statusCode: 400,
      });
  }
  const { owner } = intelligenceDetailFields(input);
  if (
    (owner && !hasDistinctMention(quotes, owner)) ||
    (input.ownershipConfidence === "explicit" && !owner)
  ) {
    fail(
      "A supplied owner must occur in the evidence quotes; use no owner when ownership is unknown.",
      { errorCode: "owner_not_in_evidence", statusCode: 400 },
    );
  }
  if (input.dueDate && !quotes.includes(input.dueDate)) {
    fail(
      "A structured due date must appear as YYYY-MM-DD in the evidence quotes. Keep relative deadlines in the details.",
      { errorCode: "due_date_not_in_evidence", statusCode: 400 },
    );
  }
}

async function intelligenceWriteIsStored(
  input: WriteIntelligenceInput,
  row: KnowledgeRow,
  effects: AfterCommitEffects,
) {
  assertIntelligenceGrounded(input, await validateEvidence(input.evidence));
  const detail = firstRow(
    await getDb()
      .select()
      .from(schema.brainKnowledgeIntelligence)
      .where(eq(schema.brainKnowledgeIntelligence.knowledgeId, row.id))
      .limit(1),
  );
  const verification = firstRow(
    await getDb()
      .select({ knowledgeId: schema.brainKnowledgeVerifications.knowledgeId })
      .from(schema.brainKnowledgeVerifications)
      .where(eq(schema.brainKnowledgeVerifications.knowledgeId, row.id))
      .limit(1),
  );
  if (!detail || verification || row.intelligenceKind !== input.kind)
    return false;
  const expected = Object.entries(intelligenceDetailFields(input)) as Array<
    [keyof DetailRow, unknown]
  >;
  if (expected.some(([key, value]) => detail[key] !== value)) return false;
  return knowledgeWriteIsStored(
    knowledgeInputForIntelligence(input),
    row,
    effects,
  );
}

async function writeIntelligenceLocked(
  input: WriteIntelligenceInput,
  effects: AfterCommitEffects,
) {
  if (input.id) {
    const { evidenceLocked } = await lockKnowledgeWriteSet({
      knowledgeId: input.id,
      evidence: input.evidence,
    });
    const access = await assertAccess("brain-knowledge", input.id, "editor");
    const row = access.resource as KnowledgeRow;
    const current = (
      await listIntelligence({ id: input.id, limit: 1 })
    ).records.find((record) => record.id === input.id);
    if (!current)
      fail("The intelligence record is unavailable or its evidence changed.", {
        errorCode: "evidence_unavailable",
        statusCode: 403,
      });
    const decision = await decideKnowledgeSave({
      record: "intelligence_record",
      expectedRevision: input.expectedRevision,
      requireRevision: true,
      row,
      current,
      evidenceLocked,
      alreadyStored: () => intelligenceWriteIsStored(input, row, effects),
    });
    if (decision === "already_applied") return { item: current };
  }
  const evidence = await validateEvidence(input.evidence);
  assertIntelligenceGrounded(input, evidence);
  const result = await writeKnowledgeRecordInTransaction(
    knowledgeInputForIntelligence(input),
    effects,
  );
  if (result.knowledge.status === "redacted")
    fail(
      "Privacy settings require redacting this record. Use an exact excerpt without email addresses and omit an email owner, then try again.",
      { errorCode: "intelligence_redaction_required", statusCode: 400 },
    );
  const snapshots: z.infer<typeof snapshotSchema> = [];
  for (const captureId of [
    ...new Set(evidence.map((entry) => entry.captureId)),
  ]) {
    const access = await getAccessibleCapture(captureId);
    if (!access)
      fail("Evidence is no longer accessible.", {
        errorCode: "evidence_unavailable",
        statusCode: 403,
      });
    snapshots.push({
      captureId,
      contentHash:
        access.capture.contentHash ?? (await sha256Hex(access.capture.content)),
    });
  }
  const marked = await getDb()
    .update(schema.brainKnowledge)
    .set({ intelligenceKind: input.kind })
    .where(
      and(
        eq(schema.brainKnowledge.id, result.knowledge.id),
        eq(schema.brainKnowledge.updatedAt, result.knowledge.updatedAt),
      ),
    )
    .returning({ id: schema.brainKnowledge.id });
  if (changedRowCount(marked) !== 1)
    throw new Error(
      `Marking knowledge ${result.knowledge.id} as intelligence did not change exactly one row.`,
    );
  const savedKnowledge = await getDb()
    .select()
    .from(schema.brainKnowledge)
    .where(
      and(
        eq(schema.brainKnowledge.id, result.knowledge.id),
        accessFilter(schema.brainKnowledge, schema.brainKnowledgeShares),
      ),
    )
    .limit(1);
  const knowledge = savedKnowledge.find(
    (record) => record.id === result.knowledge.id,
  );
  if (!knowledge)
    fail("The knowledge write could not be read back.", {
      errorCode: "knowledge_write_unavailable",
      statusCode: 409,
    });
  const detail = {
    knowledgeId: knowledge.id,
    ...intelligenceDetailFields(input),
    knowledgeRevision: await knowledgeContentRevision(knowledge),
    evidenceSnapshotsJson: JSON.stringify(snapshots),
    updatedAt: nowIso(),
  };
  const savedDetail = await getDb()
    .insert(schema.brainKnowledgeIntelligence)
    .values(detail)
    .onConflictDoUpdate({
      target: schema.brainKnowledgeIntelligence.knowledgeId,
      set: detail,
    })
    .returning({ knowledgeId: schema.brainKnowledgeIntelligence.knowledgeId });
  if (changedRowCount(savedDetail) !== 1)
    throw new Error(
      `Saving intelligence detail for ${knowledge.id} did not change exactly one row.`,
    );
  const savedVerifications = await getDb()
    .select()
    .from(schema.brainKnowledgeVerifications)
    .where(eq(schema.brainKnowledgeVerifications.knowledgeId, knowledge.id))
    .limit(1);
  if (input.id)
    await getDb()
      .delete(schema.brainKnowledgeVerifications)
      .where(eq(schema.brainKnowledgeVerifications.knowledgeId, input.id));
  const item = await itemFromRows(
    knowledge,
    detail,
    input.id
      ? null
      : (savedVerifications.find(
          (entry) => entry.knowledgeId === knowledge.id,
        ) ?? null),
  );
  if (!item)
    fail("Evidence changed while saving. Read it again before retrying.", {
      errorCode: "evidence_changed",
      statusCode: 409,
    });
  return { item };
}

export async function readPriorities(
  input: {
    period?: "daily" | "weekly" | undefined;
    owner?: string | undefined;
    limit?: number | undefined;
  } = {},
) {
  const email = requireEmail();
  const owner = input.owner?.trim() || email;
  const period = input.period ?? "daily";
  const generatedAt = nowIso();
  const preference = normalizeLocalizationPreference(
    await getUserSetting(email, LOCALIZATION_SETTING_KEY),
  );
  const requestTimezone = normalizeTimezonePreference(getRequestTimezone());
  const timezone =
    preference.timezone !== "system"
      ? preference.timezone
      : requestTimezone !== "system"
        ? requestTimezone
        : "UTC";
  const today = formatDateInTimezone(new Date(generatedAt), timezone);
  const through = new Date(
    Date.parse(`${today}T23:59:59.999Z`) +
      (period === "weekly" ? 6 : 0) * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const result = await listIntelligence({
    status: "open",
    owner,
    includeUnowned: true,
    limit: input.limit ?? 100,
    priorityThrough: through,
  });
  const relevant = result.records.filter(
    (item) =>
      (!item.owner || item.owner.toLowerCase() === owner.toLowerCase()) &&
      (!item.dueDate || item.dueDate <= through) &&
      item.verification.state !== "deprecated",
  );
  const byDue = (a: IntelligenceItem, b: IntelligenceItem) =>
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    b.updatedAt.localeCompare(a.updatedAt);
  return {
    period,
    owner,
    timezone,
    generatedAt,
    through,
    highConfidence: relevant
      .filter(
        (item) =>
          item.kind === "action" &&
          item.ownershipConfidence === "explicit" &&
          item.owner,
      )
      .sort(byDue),
    ambiguous: relevant
      .filter(
        (item) =>
          item.kind === "action" &&
          (item.ownershipConfidence === "ambiguous" || !item.owner),
      )
      .sort(byDue),
    decisions: relevant.filter((item) => item.kind === "decision").sort(byDue),
    customerRequests: relevant
      .filter((item) => item.kind === "feature-request")
      .sort(byDue),
    hasMore: result.hasMore,
    scanLimited: result.scanLimited,
  };
}

export async function verifyKnowledge(input: {
  knowledgeId: string;
  state: "verified" | "deprecated" | "unverified";
  attested: true;
  expectedRevision: string;
  remindInDays?: number | undefined;
}) {
  requireEmail();
  return getDb().transaction(async () => verifyKnowledgeLocked(input));
}

function verificationReminder(
  input: {
    state: "verified" | "deprecated" | "unverified";
    remindInDays?: number | undefined;
  },
  actedAtMs: number,
  carried: string | null,
) {
  if (input.state !== "verified") return null;
  if (input.remindInDays === undefined) return carried;
  return new Date(actedAtMs + input.remindInDays * 86_400_000).toISOString();
}

async function verifyKnowledgeLocked(input: {
  knowledgeId: string;
  state: "verified" | "deprecated" | "unverified";
  attested: true;
  expectedRevision: string;
  remindInDays?: number | undefined;
}) {
  const actorEmail = requireEmail();
  await getDb()
    .select({ id: schema.brainKnowledge.id })
    .from(schema.brainKnowledge)
    .where(eq(schema.brainKnowledge.id, input.knowledgeId))
    .limit(1)
    .for("update");
  const access = await assertAccess(
    "brain-knowledge",
    input.knowledgeId,
    "editor",
  );
  const row = access.resource as KnowledgeRow;
  await assertDerivedAudienceAccess(row);
  const details = await getDb()
    .select()
    .from(schema.brainKnowledgeIntelligence)
    .where(eq(schema.brainKnowledgeIntelligence.knowledgeId, row.id))
    .limit(1);
  const detail = details.find((entry) => entry.knowledgeId === row.id);
  if (!detail || !row.intelligenceKind)
    fail("Verification is available for structured intelligence records.", {
      errorCode: "intelligence_record_required",
      statusCode: 400,
    });
  const evidence = serializeKnowledge(row).evidence;
  const snapshots = snapshotSchema.parse(
    JSON.parse(detail.evidenceSnapshotsJson),
  );
  if (!(await currentEvidence(evidence, snapshots)))
    fail("Current accessible evidence is required to verify knowledge.", {
      errorCode: "evidence_unavailable",
      statusCode: 403,
    });
  const existingVerifications = await getDb()
    .select()
    .from(schema.brainKnowledgeVerifications)
    .where(eq(schema.brainKnowledgeVerifications.knowledgeId, row.id))
    .limit(1);
  const existingVerification = existingVerifications.find(
    (entry) => entry.knowledgeId === row.id,
  );
  const revision = await intelligenceRevision(row, detail);
  if (input.expectedRevision !== knowledgeRevision(row)) {
    if (
      existingVerification?.knowledgeRevision === revision &&
      existingVerification.state === input.state &&
      existingVerification.actorEmail === actorEmail &&
      existingVerification.remindAt ===
        verificationReminder(
          input,
          Date.parse(existingVerification.actedAt),
          existingVerification.remindAt,
        )
    ) {
      countSaveOutcome("intelligence_record", "already_applied");
      return {
        verification: verificationFor(existingVerification, revision),
        revision: knowledgeRevision(row),
      };
    }
    const current = await itemFromRows(row, detail, existingVerification);
    if (!current)
      fail(
        "This intelligence record no longer matches its structured details, so it cannot be verified. Read it again and save it with write-intelligence before verifying.",
        { errorCode: "intelligence_out_of_date", statusCode: 409 },
      );
    throw saveConflict("intelligence_record", current, knowledgeRevision(row));
  }
  const touched = await touchKnowledgeRevision(row);
  if (!touched) throw new Error(`Knowledge ${row.id} changed while locked.`);
  const actedAt = nowIso();
  const actedAtMs = Date.parse(actedAt);
  const existingRemindAt =
    existingVerification?.state === "verified" &&
    existingVerification.knowledgeRevision === revision &&
    existingVerification.remindAt &&
    Date.parse(existingVerification.remindAt) > actedAtMs
      ? existingVerification.remindAt
      : null;
  const remindAt = verificationReminder(input, actedAtMs, existingRemindAt);
  const verification = {
    knowledgeId: row.id,
    knowledgeRevision: revision,
    state: input.state,
    actorEmail,
    actedAt,
    remindAt,
  };
  const saved = await getDb()
    .insert(schema.brainKnowledgeVerifications)
    .values(verification)
    .onConflictDoUpdate({
      target: schema.brainKnowledgeVerifications.knowledgeId,
      set: verification,
    })
    .returning({ knowledgeId: schema.brainKnowledgeVerifications.knowledgeId });
  if (changedRowCount(saved) !== 1)
    throw new Error(
      `Saving the verification of ${row.id} did not change exactly one row.`,
    );
  countSaveOutcome("intelligence_record", "written");
  return {
    verification: verificationFor(verification, verification.knowledgeRevision),
    revision: knowledgeRevision(touched),
  };
}

export async function getEntityGraph(
  input: {
    query?: string | undefined;
    type?: string | undefined;
    limit?: number | undefined;
  } = {},
) {
  requireEmail();
  const limit = Math.min(input.limit ?? 50, 100);
  const { rows, scanLimited } = await searchKnowledgePage({
    query: input.query,
    includeDrafts: true,
    statuses: ["draft", "published", "redacted"],
    limit: 101,
  });
  const entities = new Map<
    string,
    {
      id: string;
      type: string;
      name: string;
      evidenceCount: number;
      evidenceTruncated: boolean;
      knowledgeIds: string[];
      evidence: BrainEvidence[];
    }
  >();
  const edges: Array<{
    title: string;
    structured: boolean;
    id: string;
    source: string;
    target: string;
    relation: "mentioned-in" | "owns";
    knowledgeId: string;
    evidenceCount: number;
    evidenceTruncated: boolean;
    evidence: BrainEvidence[];
  }> = [];
  const metadata = rows.length
    ? await getDb()
        .select()
        .from(schema.brainKnowledgeIntelligence)
        .where(
          inArray(
            schema.brainKnowledgeIntelligence.knowledgeId,
            rows.map((row) => row.id),
          ),
        )
        .limit(rows.length)
    : [];
  const details = new Map(
    metadata.map((detail) => [detail.knowledgeId, detail]),
  );
  const loaded = await loadCurrentEvidence(
    rows.flatMap((row) => serializeKnowledge(row).evidence),
  );
  for (const row of rows) {
    if (
      row.status !== "published" &&
      row.status !== "draft" &&
      row.status !== "redacted"
    )
      continue;
    const knowledge = serializeKnowledge(row);
    const detail = details.get(row.id);
    if (
      detail &&
      detail.knowledgeRevision !== (await knowledgeContentRevision(row))
    )
      continue;
    if (detail) {
      const snapshots = snapshotSchema.parse(
        JSON.parse(detail.evidenceSnapshotsJson),
      );
      if (!(await currentEvidence(knowledge.evidence, snapshots, loaded)))
        continue;
    }
    const quotes = knowledge.evidence
      .map((entry) => entry.quote)
      .join("\n")
      .toLowerCase();
    for (const entity of knowledge.entities) {
      if (!hasDistinctMention(quotes, entity.name)) continue;
      if (input.type && entity.type !== input.type) continue;
      if (
        input.query &&
        !`${entity.name} ${knowledge.title} ${knowledge.topic ?? ""}`
          .toLowerCase()
          .includes(input.query.toLowerCase())
      )
        continue;
      const id = `${entity.type}:${entity.name.toLowerCase()}`;
      const node = entities.get(id) ?? {
        id,
        type: entity.type,
        name: entity.name,
        evidenceCount: 0,
        evidenceTruncated: false,
        knowledgeIds: [],
        evidence: [],
      };
      node.knowledgeIds.push(row.id);
      node.evidence.push(
        ...knowledge.evidence
          .slice(0, Math.max(0, 3 - node.evidence.length))
          .map((entry) => ({ ...entry, quote: entry.quote.slice(0, 2000) })),
      );
      node.evidenceCount += knowledge.evidence.length;
      node.evidenceTruncated =
        node.evidenceCount > node.evidence.length ||
        knowledge.evidence.some((entry) => entry.quote.length > 2000);
      entities.set(id, node);
      const relation =
        detail?.ownershipConfidence === "explicit" &&
        detail.owner?.toLowerCase() === entity.name.toLowerCase()
          ? "owns"
          : "mentioned-in";
      edges.push({
        title: knowledge.title,
        structured: Boolean(detail),
        id: `${id}:${row.id}`,
        source: id,
        target: row.id,
        relation,
        knowledgeId: row.id,
        evidenceCount: knowledge.evidence.length,
        evidenceTruncated:
          knowledge.evidence.length > 1 ||
          knowledge.evidence.some((entry) => entry.quote.length > 2000),
        evidence: knowledge.evidence
          .slice(0, 1)
          .map((entry) => ({ ...entry, quote: entry.quote.slice(0, 2000) })),
      });
    }
  }
  const selected = [...entities.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
  const selectedIds = new Set(selected.map((node) => node.id));
  const selectedEdges = edges.filter((edge) => selectedIds.has(edge.source));
  return {
    entities: selected,
    edges: selectedEdges.slice(0, 200),
    hasMore: entities.size > limit || scanLimited || selectedEdges.length > 200,
  };
}

function unreadableKnowledgeEvidence(): never {
  fail(
    "Stored knowledge evidence is unreadable. Retrieval could not complete.",
    {
      errorCode: "knowledge_evidence_unreadable",
      statusCode: 409,
    },
  );
}

export async function filterCurrentKnowledgeRows(
  rows: KnowledgeRow[],
  options: { includeDeprecated?: boolean } = {},
) {
  const structured = rows.filter((row) => row.intelligenceKind);
  const ids = structured.map((row) => row.id);
  const details = ids.length
    ? await getDb()
        .select()
        .from(schema.brainKnowledgeIntelligence)
        .where(inArray(schema.brainKnowledgeIntelligence.knowledgeId, ids))
        .limit(ids.length)
    : [];
  const verifications = ids.length
    ? await getDb()
        .select()
        .from(schema.brainKnowledgeVerifications)
        .where(inArray(schema.brainKnowledgeVerifications.knowledgeId, ids))
        .limit(ids.length)
    : [];
  const detailMap = new Map(
    details.map((detail) => [detail.knowledgeId, detail]),
  );
  const verificationMap = new Map(
    verifications.map((verification) => [
      verification.knowledgeId,
      verification,
    ]),
  );
  const evidenceById = new Map<string, z.infer<typeof evidenceQuoteSchema>>();
  const evidenceForLookup: Array<Pick<BrainEvidence, "captureId">> = [];
  for (const row of rows) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(row.evidenceJson);
    } catch (error) {
      if (error instanceof SyntaxError) unreadableKnowledgeEvidence();
      throw error;
    }
    const parsed = evidenceQuoteSchema.safeParse(decoded);
    if (!parsed.success) unreadableKnowledgeEvidence();
    evidenceById.set(row.id, parsed.data);
    evidenceForLookup.push(...parsed.data);
    if (row.captureId) evidenceForLookup.push({ captureId: row.captureId });
  }
  const loaded = await loadCurrentEvidence(evidenceForLookup);
  const current: KnowledgeRow[] = [];
  const digestCache: CaptureDigestCache = new Map();
  for (const row of rows) {
    const evidence = evidenceById.get(row.id);
    if (!evidence || (row.captureId && !loaded.has(row.captureId))) continue;
    if (!row.intelligenceKind) {
      if (
        isEvidenceBackedKnowledge(row) &&
        !(await ordinaryKnowledgeIsCurrent(row, loaded, digestCache))
      )
        continue;
      current.push(row);
      continue;
    }
    const detail = detailMap.get(row.id);
    if (!detail) continue;
    const verification = verificationMap.get(row.id);
    if (detail.knowledgeRevision !== (await knowledgeContentRevision(row)))
      continue;
    const snapshots = snapshotSchema.parse(
      JSON.parse(detail.evidenceSnapshotsJson),
    );
    if (!(await currentEvidence(evidence, snapshots, loaded))) continue;
    const revision = await intelligenceRevision(row, detail);
    if (
      !options.includeDeprecated &&
      verificationFor(verification ?? null, revision).state === "deprecated"
    )
      continue;
    current.push(row);
  }
  return current;
}
