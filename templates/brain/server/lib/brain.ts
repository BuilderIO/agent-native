import {
  ActionContractError,
  fail,
  isActionContractError,
} from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { getDbExec } from "@agent-native/core/db";
import {
  deletePrivateBlob,
  putPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import {
  ensureResourceStoreReady,
  resourceDeleteWithDb,
  resourcePutWithDb,
  SHARED_OWNER,
} from "@agent-native/core/resources/store";
import { SAVE_CONFLICT_ERROR_CODE } from "@agent-native/core/save-conflict";
import {
  changedRowCount,
  checkSaveRevision,
  countSaveOutcome,
  saveConflict,
  saveRevisionOf,
} from "@agent-native/core/save-conflict/server";
import { encryptSecretValue } from "@agent-native/core/secrets";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import {
  getOrgSetting,
  getSetting,
  mutateOrgSetting,
} from "@agent-native/core/settings";
import {
  accessFilter,
  assertAccess,
  ForbiddenError,
  resolveAccess,
  type ResolvedAccess,
} from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  ilike,
  isNull,
  like,
  lte,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import {
  COMPANY_CONTEXT_INTAKE_KEY,
  COMPANY_CONTEXT_SOURCE_ID_PREFIX,
  DEFAULT_BRAIN_SETTINGS,
  type BrainCaptureKind,
  type BrainEvidence,
  type BrainEvidenceInput,
  type BrainKnowledgeKind,
  type BrainKnowledgeStatus,
  type BrainProposalAction,
  type BrainPublishTier,
  type BrainSettings,
  type BrainSourceProvider,
  type BrainSourceStatus,
} from "../../shared/types.js";
import { getDb, schema } from "../db/index.js";
import {
  type AudienceInvalidationFlush,
  captureIdsAffectedByAudienceAssignment,
  ensureCaptureAudience,
  ensureEvidenceIntersectionAudience,
  listAccessibleAudienceIds,
} from "./audiences.js";
import {
  publicCaptureTitle,
  sanitizeCaptureForStorage,
  type CaptureSanitizationResult,
} from "./capture-sanitization.js";
import {
  enqueueCaptureInvalidation,
  enqueueBrainOperation,
} from "./ingest-queue.js";
import {
  buildKnowledgeProvenance,
  evidenceCaptureIds,
  isEvidenceBackedKnowledge,
} from "./knowledge-provenance.js";
import {
  BRAIN_SENSITIVITY_POLICY_VERSION,
  parseCaptureMetadata,
  publicCaptureExternalId,
  publicCaptureMetadata,
  withOmissionReceipt,
  readWithheldPassages,
  type BrainAudienceAssignment,
  type BrainSensitivityDecision,
} from "./search-index-contracts.js";
import { personalGoogleSourceFilter } from "./source-access.js";

export const BRAIN_SETTINGS_KEY = "brain-settings";

export function isCompanyContextIntakeConfig(configJson: string | null) {
  return (
    parseJson<Record<string, unknown>>(configJson, {})[
      COMPANY_CONTEXT_INTAKE_KEY
    ] === true
  );
}

// One deterministic id per org so concurrent first uploads collide on the
// primary key instead of creating duplicate intake sources.
export function companyContextSourceId(orgId: string) {
  return `${COMPANY_CONTEXT_SOURCE_ID_PREFIX}${orgId}`;
}

export function isCompanyContextIntakeSource(source: {
  id: string;
  orgId: string | null;
  configJson: string | null;
}) {
  return (
    !!source.orgId &&
    source.id === companyContextSourceId(source.orgId) &&
    isCompanyContextIntakeConfig(source.configJson)
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

export function requireUserEmail(): string {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return email;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

const SOURCE_URL_METADATA_KEYS = [
  "sourceUrl",
  "url",
  "permalink",
  "webUrl",
  "web_url",
] as const;

export function isDirectGranolaSummaryUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    if (host === "notes.granola.ai") return true;
    if (host === "granola.ai" || host.endsWith(".granola.ai")) {
      return pathname.startsWith("/d/") || pathname.includes("/note");
    }
    return host.includes("granola.example");
  } catch {
    return false;
  }
}

export function safeCitationUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || isDirectGranolaSummaryUrl(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function sourceUrlFromMetadataRecord(
  metadata: Record<string, unknown>,
): string | null {
  for (const key of SOURCE_URL_METADATA_KEYS) {
    const value = safeCitationUrl(publicCaptureMetadata(metadata)[key]);
    if (value) return value;
  }
  return null;
}

function sanitizeGranolaCaptureMetadataLinks(
  provider: BrainSourceProvider,
  metadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!metadata || provider !== "granola") return metadata;
  const next = { ...metadata };
  for (const key of SOURCE_URL_METADATA_KEYS) {
    if (isDirectGranolaSummaryUrl(next[key])) delete next[key];
  }
  return next;
}

export function sanitizeEvidenceCitationUrls(
  evidence: BrainEvidence[],
): BrainEvidence[] {
  return evidence.map((item) => {
    const next: BrainEvidence = { ...item };
    if (next.capturedAtSource !== "manual-markdown") delete next.capturedAt;
    const sourceUrl = safeCitationUrl(next.sourceUrl);
    const url = safeCitationUrl(next.url);
    if (sourceUrl) next.sourceUrl = sourceUrl;
    else delete next.sourceUrl;
    if (url) next.url = url;
    else delete next.url;
    return next;
  });
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function contentHash(content: string): Promise<string> {
  return sha256Hex(content);
}

function serializeSourceConfig(config: Record<string, unknown>) {
  const sanitized = { ...config };
  delete sanitized.ingestTokenHash;
  delete sanitized.sourceKey;
  return sanitized;
}

async function readLegacyBrainSettings(orgId: string | null | undefined) {
  const firstOrgIds = await readFirstOrganizationIds(2);
  const owned = orgId
    ? firstOrgIds.length === 0 || firstOrgIds[0] === orgId
    : firstOrgIds.length <= 1;
  return owned ? getSetting(BRAIN_SETTINGS_KEY) : null;
}

async function readFirstOrganizationIds(limit: number): Promise<string[]> {
  try {
    const { rows } = await getDbExec().execute({
      sql: "SELECT id FROM organizations ORDER BY created_at ASC, id ASC LIMIT ?",
      args: [limit],
    });
    return rows.map((row) => String(row.id));
  } catch (error) {
    if (!isMissingOrganizationsTable(error)) throw error;
    return [];
  }
}

function isMissingOrganizationsTable(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  return (
    candidate?.code === "42P01" &&
    /relation ["']?organizations["']? does not exist/i.test(
      String(candidate.message ?? ""),
    )
  );
}

export async function readBrainSettings(
  orgId: string | null | undefined = getRequestOrgId(),
): Promise<BrainSettings> {
  const stored =
    (orgId ? await getOrgSetting(orgId, BRAIN_SETTINGS_KEY) : null) ??
    (await readLegacyBrainSettings(orgId));
  return {
    ...DEFAULT_BRAIN_SETTINGS,
    ...(stored ?? {}),
  } as BrainSettings;
}

// Patches merge inside the store's compare-and-swap so concurrent one-field
// saves both land, and a failed read fails the save instead of merging the
// patch into defaults and wiping every other stored field.
export async function writeBrainSettings(
  orgId: string,
  patch: { [K in keyof BrainSettings]?: BrainSettings[K] | undefined },
): Promise<BrainSettings> {
  const legacy = await readLegacyBrainSettings(orgId);
  const stored = await mutateOrgSetting(
    orgId,
    BRAIN_SETTINGS_KEY,
    (current) => ({
      ...DEFAULT_BRAIN_SETTINGS,
      ...(current ?? legacy ?? {}),
      ...patch,
    }),
  );
  return { ...DEFAULT_BRAIN_SETTINGS, ...stored } as BrainSettings;
}

export interface BrainAgentGuidance {
  identity: {
    assistantName: string;
    companyName: string | null;
    tone: NonNullable<BrainSettings["assistantTone"]>;
  };
  retrieval: {
    sourcePolicy: NonNullable<BrainSettings["sourcePolicy"]>;
    requireCitations: boolean;
    approvedKnowledgeFirst: boolean;
    rawCaptureFallback: "never-answer" | "thin-results" | "allowed-leads";
    instructions: string[];
  };
  distillation: {
    defaultPublishTier: BrainPublishTier;
    autoRedactEmails: boolean;
    instructions: string;
    rules: string[];
  };
  captureSanitization: {
    enabled: boolean;
    model: string | null;
    instructions: string;
    rules: string[];
  };
  response: {
    toneInstruction: string;
    citationInstruction: string;
  };
}

function toneInstruction(tone: NonNullable<BrainSettings["assistantTone"]>) {
  switch (tone) {
    case "friendly":
      return "Use a warm, concise, helpful tone.";
    case "formal":
      return "Use a polished, formal tone suitable for company records.";
    case "technical":
      return "Use a precise technical tone and preserve implementation details.";
    case "direct":
    default:
      return "Use a direct, concise tone.";
  }
}

function retrievalPolicy(
  sourcePolicy: NonNullable<BrainSettings["sourcePolicy"]>,
) {
  switch (sourcePolicy) {
    case "strict":
      return {
        rawCaptureFallback: "never-answer" as const,
        instructions: [
          "Answer from distilled Brain knowledge only.",
          "Use raw captures for distillation and exact quote validation, not as answer support.",
          "If distilled knowledge is missing or thin, say Brain does not have enough distilled support.",
        ],
      };
    case "exploratory":
      return {
        rawCaptureFallback: "allowed-leads" as const,
        instructions: [
          "Use distilled Brain knowledge together with synced captures (Slack, Zoom, and other connected sources) whose answerEligible is true.",
          "Name the source (channel or meeting) and date behind each fact, and prefer the most recent capture when sources disagree.",
          "Label weaker or conflicting signals as uncertain instead of dropping them.",
        ],
      };
    case "balanced":
    default:
      return {
        rawCaptureFallback: "thin-results" as const,
        instructions: [
          "Prefer distilled Brain knowledge.",
          "When distilled knowledge is missing or thin, answer from synced captures (Slack, Zoom, and other connected sources) whose answerEligible is true, naming the source (channel or meeting) and date behind each fact.",
          "Do not invent facts beyond returned Brain results.",
        ],
      };
  }
}

export function buildBrainAgentGuidance(
  settings: BrainSettings,
): BrainAgentGuidance {
  const assistantName = settings.assistantName?.trim() || "Brain";
  const companyName = settings.companyName?.trim() || null;
  const tone = settings.assistantTone ?? "direct";
  const sourcePolicy = settings.sourcePolicy ?? "balanced";
  const retrieval = retrievalPolicy(sourcePolicy);
  const requireCitations = settings.requireCitations !== false;
  const distillationInstructions =
    settings.distillationInstructions?.trim() ||
    DEFAULT_BRAIN_SETTINGS.distillationInstructions;
  const captureSanitizationInstructions =
    settings.captureSanitizationInstructions?.trim() ||
    DEFAULT_BRAIN_SETTINGS.captureSanitizationInstructions ||
    "";

  return {
    identity: {
      assistantName,
      companyName,
      tone,
    },
    retrieval: {
      sourcePolicy,
      requireCitations,
      approvedKnowledgeFirst: true,
      rawCaptureFallback: retrieval.rawCaptureFallback,
      instructions: retrieval.instructions,
    },
    distillation: {
      defaultPublishTier: settings.defaultPublishTier,
      autoRedactEmails: settings.autoRedactEmails,
      instructions: distillationInstructions,
      rules: [
        "Extract durable, reusable institutional knowledge only.",
        "Treat explicit company or product launch announcements as retainable dated facts, even when a capture is a single short message. Distinguish announced plans from confirmed launches; never claim a launch happened solely because someone said it would happen today.",
        settings.captureSanitizationEnabled === false
          ? "Captures may contain raw provider text; avoid personal or out-of-scope material."
          : "Transcript captures are pre-sanitized before storage; treat capture text as the durable company-relevant source.",
        "Preserve short exact quotes as evidence.",
        `Use ${settings.defaultPublishTier} as the default publish tier unless the user or capture context clearly calls for another tier.`,
        "write-knowledge publishes directly; there is no review step.",
        settings.autoRedactEmails
          ? "Email addresses are auto-redacted by write-knowledge; still avoid adding unnecessary personal data."
          : "Email auto-redaction is disabled; avoid including personal data unless it is essential evidence.",
      ],
    },
    captureSanitization: {
      enabled: settings.captureSanitizationEnabled !== false,
      model: settings.captureSanitizationModel?.trim() || null,
      instructions: captureSanitizationInstructions,
      rules: [
        "Run before transcript-style captures are inserted into SQL.",
        "Keep company/product/customer/GTM/technical/process information.",
        "Always strip recruiting, hiring, candidate evaluation, interview feedback, compensation, references, and personnel assessment.",
        "Drop personal life details, casual small talk, secrets, credentials, and raw transcript metadata.",
        "Granola, Clips, signed generic transcript ingest, and manual transcript imports share this boundary.",
      ],
    },
    response: {
      toneInstruction: toneInstruction(tone),
      citationInstruction:
        sourcePolicy === "strict"
          ? requireCitations
            ? "Cite published Brain knowledge evidence for factual claims; raw captures are not answer citations under the strict policy; say when distilled support is missing."
            : "Include published Brain knowledge citations when helpful; raw captures are not answer evidence under the strict policy, and concise uncited summaries are allowed by workspace settings."
          : requireCitations
            ? "Cite published Brain knowledge or answer-eligible captures for factual claims, giving each capture's source (channel or meeting), date, and link; say when support is missing."
            : "Include knowledge or answer-eligible capture citations (source, date, link) when helpful; concise uncited summaries are allowed by workspace settings.",
    },
  };
}

export async function readBrainAgentGuidance() {
  const settings = await readBrainSettings();
  return {
    settings,
    guidance: buildBrainAgentGuidance(settings),
  };
}

export function serializeSource(row: typeof schema.brainSources.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    provider: row.provider as BrainSourceProvider,
    status: row.status as BrainSourceStatus,
    config: serializeSourceConfig(parseJson(row.configJson, {})),
    cursor: parseJson(row.cursorJson, {}),
    visibility: row.visibility,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeCapture(
  row: typeof schema.brainRawCaptures.$inferSelect,
) {
  const metadata = parseCaptureMetadata(
    withOmissionReceipt(row.metadataJson, row.content, row.kind),
  );
  const partial =
    metadata !== null && readWithheldPassages(metadata) !== undefined;
  return {
    id: row.id,
    sourceId: row.sourceId,
    externalId: publicCaptureExternalId(row.externalId, metadata, row.kind),
    title: publicCaptureTitle(row.title, partial),
    kind: row.kind as BrainCaptureKind,
    content: row.content,
    contentHash: row.contentHash,
    metadata: publicCaptureMetadata(metadata),
    capturedAt: row.capturedAt,
    importedBy: row.importedBy,
    status: row.status,
    distilledAt: row.distilledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type BrainDistillationQueueStatus =
  | "queued"
  | "processing"
  | "done"
  | "failed";

export function serializeDistillationQueue(
  row: typeof schema.brainIngestQueue.$inferSelect,
) {
  return {
    id: row.id,
    sourceId: row.sourceId,
    captureId: row.captureId,
    status: row.status as BrainDistillationQueueStatus,
    priority: row.priority,
    attempts: row.attempts,
    error: row.error,
    runAfter: row.runAfter,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function latestDistillationQueuesForCaptures(
  captureIds: string[],
) {
  if (!captureIds.length) {
    return new Map<string, ReturnType<typeof serializeDistillationQueue>>();
  }
  const rows = await getDb()
    .select()
    .from(schema.brainIngestQueue)
    .where(
      and(
        inArray(schema.brainIngestQueue.captureId, captureIds),
        eq(schema.brainIngestQueue.operation, "distill"),
      ),
    )
    .orderBy(desc(schema.brainIngestQueue.updatedAt))
    .limit(Math.max(captureIds.length * 4, 10));
  const byCapture = new Map<
    string,
    ReturnType<typeof serializeDistillationQueue>
  >();
  for (const row of rows) {
    if (!row.captureId || byCapture.has(row.captureId)) continue;
    byCapture.set(row.captureId, serializeDistillationQueue(row));
  }
  return byCapture;
}

type KnowledgeRow = typeof schema.brainKnowledge.$inferSelect;

const KNOWLEDGE_COLUMNS: Record<keyof KnowledgeRow, boolean> = {
  id: true,
  sourceId: true,
  captureId: true,
  audienceId: true,
  audienceAclHash: true,
  kind: true,
  title: true,
  body: true,
  summary: true,
  topic: true,
  tagsJson: true,
  entitiesJson: true,
  evidenceJson: true,
  intelligenceKind: true,
  provenanceJson: true,
  publishedResourcePath: false,
  supersedesId: true,
  supersededById: true,
  confidence: true,
  status: true,
  publishTier: true,
  createdBy: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  ownerEmail: true,
  orgId: true,
  visibility: true,
};
const knowledgeColumnKeys = (
  Object.keys(KNOWLEDGE_COLUMNS) as Array<keyof KnowledgeRow>
).filter((key) => KNOWLEDGE_COLUMNS[key]);

export function knowledgeRevision(row: KnowledgeRow): string {
  return saveRevisionOf(
    Object.fromEntries(
      knowledgeColumnKeys.map((key) => [key, row[key] ?? null]),
    ),
  );
}

export function nextKnowledgeUpdatedAt(stored: string) {
  const now = nowIso();
  return now > stored ? now : new Date(Date.parse(stored) + 1).toISOString();
}

function knowledgeRowUnchanged(row: KnowledgeRow) {
  return and(
    ...knowledgeColumnKeys.map((key) => {
      const value = row[key] ?? null;
      return value === null
        ? isNull(schema.brainKnowledge[key])
        : eq(schema.brainKnowledge[key], value);
    }),
  );
}

export function serializeKnowledge(row: KnowledgeRow) {
  return {
    id: row.id,
    sourceId: row.sourceId,
    captureId: row.captureId,
    audienceId: row.audienceId,
    audienceAclHash: row.audienceAclHash,
    kind: row.kind as BrainKnowledgeKind,
    title: row.title,
    body: row.body,
    summary: row.summary,
    topic: row.topic,
    tags: parseJson<string[]>(row.tagsJson, []),
    entities: parseJson<Array<{ type: string; name: string }>>(
      row.entitiesJson,
      [],
    ),
    evidence: sanitizeEvidenceCitationUrls(
      parseJson<BrainEvidence[]>(row.evidenceJson, []),
    ),
    publishedResourcePath: row.publishedResourcePath,
    supersedesId: row.supersedesId,
    supersededById: row.supersededById,
    confidence: row.confidence,
    status: row.status as BrainKnowledgeStatus,
    publishTier: row.publishTier as BrainPublishTier,
    visibility: row.visibility,
    createdBy: row.createdBy,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: knowledgeRevision(row),
  };
}

export function serializeProposal(
  row: typeof schema.brainProposals.$inferSelect,
) {
  return {
    id: row.id,
    knowledgeId: row.knowledgeId,
    sourceId: row.sourceId,
    captureId: row.captureId,
    audienceId: row.audienceId,
    audienceAclHash: row.audienceAclHash,
    title: row.title,
    body: row.body,
    rationale: row.rationale,
    proposedAction: row.proposedAction as BrainProposalAction,
    payload: parseJson(row.payloadJson, {}),
    evidence: sanitizeEvidenceCitationUrls(
      parseJson<BrainEvidence[]>(row.evidenceJson, []),
    ),
    status: row.status,
    visibility: row.visibility,
    reviewerNotes: row.reviewerNotes,
    createdBy: row.createdBy,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getAccessibleSource(
  sourceId: string,
  role: "viewer" | "commenter" | "editor" | "admin" | "owner" = "viewer",
): Promise<ResolvedAccess> {
  if (role !== "viewer") {
    return assertAccess("brain-source", sourceId, role);
  }
  const access = await resolveAccess("brain-source", sourceId);
  if (!access)
    fail(`No access to brain source ${sourceId}`, {
      errorCode: "source_unavailable",
      statusCode: 403,
    });
  return access;
}

export async function getAccessibleCapture(captureId: string) {
  const db = getDb();
  const [capture] = await db
    .select()
    .from(schema.brainRawCaptures)
    .where(eq(schema.brainRawCaptures.id, captureId))
    .limit(1);
  if (!capture) return null;
  const sourceAccess = await resolveAccess("brain-source", capture.sourceId);
  if (!sourceAccess) return null;
  if (capture.sensitivityDisposition !== "allowed") return null;
  const audienceIds = await listAccessibleAudienceIds([capture.sourceId]);
  if (!audienceIds.length) return null;
  const [captureAudience] = await db
    .select({ id: schema.brainCaptureAudiences.id })
    .from(schema.brainCaptureAudiences)
    .where(
      and(
        eq(schema.brainCaptureAudiences.captureId, captureId),
        inArray(schema.brainCaptureAudiences.audienceId, audienceIds),
      ),
    )
    .limit(1);
  if (!captureAudience) return null;
  return { capture, source: sourceAccess.resource, role: sourceAccess.role };
}

export async function assertDerivedAudienceAccess(row: {
  id?: string;
  intelligenceKind?: string | null;
  captureId?: string | null;
  audienceId?: string | null;
  sourceId?: string | null;
}) {
  if (!row.captureId) return;
  if (!row.audienceId || !row.sourceId) {
    fail("No access to derived Brain evidence", {
      errorCode: "evidence_unavailable",
      statusCode: 403,
    });
  }
  const sourceAccess = await resolveAccess("brain-source", row.sourceId);
  if (!sourceAccess)
    fail("No access to derived Brain evidence", {
      errorCode: "evidence_unavailable",
      statusCode: 403,
    });
  const audienceIds = await listAccessibleAudienceIds([row.sourceId]);
  if (!audienceIds.includes(row.audienceId)) {
    fail("No access to derived Brain evidence", {
      errorCode: "evidence_unavailable",
      statusCode: 403,
    });
  }
  if (row.id && row.intelligenceKind) {
    const current = await resolveAccess("brain-knowledge", row.id);
    if (!current)
      fail("The knowledge is no longer accessible.", {
        errorCode: "evidence_unavailable",
        statusCode: 403,
      });
    const { filterCurrentKnowledgeRows } = await import("./intelligence.js");
    if (
      !(
        await filterCurrentKnowledgeRows([current.resource], {
          includeDeprecated: true,
        })
      ).length
    ) {
      fail("The knowledge evidence is no longer current or accessible.", {
        errorCode: "evidence_unavailable",
        statusCode: 403,
      });
    }
  }
}

export async function createSource(
  values: {
    id?: string;
    title: string;
    provider: BrainSourceProvider;
    config?: Record<string, unknown>;
    visibility?: "private" | "org";
  },
  db: ReturnType<typeof getDb> = getDb(),
) {
  const now = nowIso();
  const ownerEmail = requireUserEmail();
  const orgId = getRequestOrgId() ?? null;
  const id = values.id ?? nanoid();
  await db.insert(schema.brainSources).values({
    id,
    title: values.title,
    provider: values.provider,
    status: "active",
    sourceKey:
      typeof values.config?.sourceKey === "string"
        ? values.config.sourceKey
        : null,
    ingestTokenHash:
      typeof values.config?.ingestTokenHash === "string"
        ? values.config.ingestTokenHash
        : null,
    configJson: stableJson(values.config ?? {}),
    cursorJson: "{}",
    lastSyncedAt: null,
    lastError: null,
    ownerEmail,
    orgId,
    visibility: values.visibility ?? "private",
    createdAt: now,
    updatedAt: now,
  });
  const [source] = await db
    .select()
    .from(schema.brainSources)
    .where(eq(schema.brainSources.id, id))
    .limit(1);
  return source;
}

export function manualSourceWhere(title: string) {
  const orgId = getRequestOrgId();
  return and(
    eq(schema.brainSources.ownerEmail, requireUserEmail()),
    eq(schema.brainSources.provider, "manual"),
    eq(schema.brainSources.title, title),
    orgId
      ? eq(schema.brainSources.orgId, orgId)
      : isNull(schema.brainSources.orgId),
  );
}

export async function ensureManualSource(title = "Manual imports") {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.brainSources)
    .where(manualSourceWhere(title))
    .limit(1);
  if (existing) return existing;
  return createSource({ title, provider: "manual" });
}

function isUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return /unique constraint|duplicate key|duplicate entry|unique/i.test(
      String(error),
    );
  }

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  if (candidate.code === "23505") {
    return true;
  }
  if (typeof candidate.message === "string") {
    if (
      /unique constraint|duplicate key|duplicate entry|unique violation|unique/i.test(
        candidate.message,
      )
    ) {
      return true;
    }
  }
  return candidate.cause !== error && isUniqueConflict(candidate.cause);
}

const UPSTREAM_DELETED_POLICY_VERSION = "upstream-deleted-v1";

async function upstreamDeletionLocatorHmac(
  sourceId: string,
  externalId: string,
) {
  return sha256Hex(`${sourceId}\0${externalId}`);
}

async function findUpstreamDeletionReceipt(
  sourceId: string,
  externalId: string,
): Promise<BrainSensitivityReceipt | null> {
  const [receipt] = await getDb()
    .select({
      id: schema.brainSensitivityEvents.id,
      sourceId: schema.brainSensitivityEvents.sourceId,
    })
    .from(schema.brainSensitivityEvents)
    .where(
      and(
        eq(
          schema.brainSensitivityEvents.locatorHmac,
          await upstreamDeletionLocatorHmac(sourceId, externalId),
        ),
        eq(
          schema.brainSensitivityEvents.policyVersion,
          UPSTREAM_DELETED_POLICY_VERSION,
        ),
        eq(schema.brainSensitivityEvents.disposition, "suppressed"),
      ),
    )
    .limit(1);
  return receipt
    ? {
        id: receipt.id,
        sourceId: receipt.sourceId,
        disposition: "suppressed",
        categories: [],
        confidenceBand: "deterministic",
        policyVersion: UPSTREAM_DELETED_POLICY_VERSION,
        expiresAt: null,
      }
    : null;
}

function captureMetadataFingerprint(metadata: Record<string, unknown>) {
  const comparable = { ...metadata };
  delete comparable.captureSanitization;
  // Connectors stamp every re-pull with a fresh run id; it must not re-queue unchanged captures.
  delete comparable.syncRunId;
  delete comparable.capturedAtExplicit;
  return stableJson(comparable);
}

export type CaptureInput = {
  id?: string;
  sourceId: string;
  externalId?: string | null | undefined;
  title: string;
  kind?: BrainCaptureKind | undefined;
  content: string;
  metadata?: Record<string, unknown> | undefined;
  capturedAt?: string | undefined;
  capturedAtSource?: "manual-markdown" | undefined;
  status?: "queued" | "distilling" | "distilled" | "ignored";
  audience?: {
    kind: BrainAudienceAssignment["kind"];
    memberEmails?: string[];
    upstreamRefHash?: string | null;
  };
  // Only for repo-authored fixture text (demo/eval seeds); ingested content must use the workspace classifier.
  privacyClassifier?: "deterministic";
};

const preparedCaptureBrand = Symbol("prepared-capture");
export interface PreparedCapture {
  readonly [preparedCaptureBrand]: true;
}
interface PreparedCaptureData {
  values: CaptureInput & { kind: BrainCaptureKind };
  preserveExistingKind: boolean;
  actor: string;
  sourceRevision: string;
  settingsRevision: string;
  settings: BrainSettings;
  sanitized: CaptureSanitizationResult;
}
const preparedCaptures = new WeakMap<PreparedCapture, PreparedCaptureData>();

function captureScreeningSourceRevision(
  source: typeof schema.brainSources.$inferSelect,
) {
  return stableJson([
    source.id,
    source.title,
    source.provider,
    source.ownerEmail,
    source.orgId,
    source.visibility,
    source.configJson,
  ]);
}

export async function prepareCapture(
  input: CaptureInput,
): Promise<PreparedCapture> {
  const values = structuredClone(input);
  const sourceAccess = await getAccessibleSource(values.sourceId, "editor");
  const source =
    sourceAccess.resource as typeof schema.brainSources.$inferSelect;
  const upstreamDeletionReceipt = values.externalId
    ? await findUpstreamDeletionReceipt(values.sourceId, values.externalId)
    : null;
  if (upstreamDeletionReceipt)
    throw new BrainCaptureBlockedError(upstreamDeletionReceipt);
  const preserveExistingKind = values.kind === undefined;
  const existing =
    preserveExistingKind && values.externalId
      ? firstRow(
          await getDb()
            .select({ kind: schema.brainRawCaptures.kind })
            .from(schema.brainRawCaptures)
            .where(
              and(
                eq(schema.brainRawCaptures.sourceId, values.sourceId),
                eq(schema.brainRawCaptures.externalId, values.externalId),
              ),
            )
            .limit(1),
        )
      : undefined;
  const resolvedValues: CaptureInput & { kind: BrainCaptureKind } = {
    ...values,
    kind: values.kind ?? existing?.kind ?? "document",
  };
  const settings = await readBrainSettings();
  const actor = requireUserEmail().trim().toLowerCase();
  const sourceRevision = captureScreeningSourceRevision(source);
  const settingsRevision = stableJson(settings);
  const metadata = sanitizeGranolaCaptureMetadataLinks(
    source.provider as BrainSourceProvider,
    values.metadata,
  );
  const sanitized = await sanitizeCaptureForStorage({
    kind: resolvedValues.kind,
    title: values.title,
    content: values.content,
    metadata,
    capturedAt: values.capturedAt,
    source: {
      id: source.id,
      title: source.title,
      provider: source.provider as BrainSourceProvider,
      ownerEmail: source.ownerEmail,
      orgId: source.orgId,
    },
    sourceConfig: parseCaptureMetadata(source.configJson) ?? {
      unreadableSourceConfig: true,
    },
    settings: values.privacyClassifier
      ? { ...settings, privacyClassifier: values.privacyClassifier }
      : settings,
  });
  const token: PreparedCapture = Object.freeze({
    [preparedCaptureBrand]: true as const,
  });
  preparedCaptures.set(token, {
    values: resolvedValues,
    preserveExistingKind,
    actor,
    sourceRevision,
    settingsRevision,
    settings,
    sanitized,
  });
  return token;
}

export async function createCapture(values: CaptureInput) {
  return commitPreparedCapture(await prepareCapture(values));
}

export async function createCaptureWithWarnings(values: CaptureInput) {
  return commitPreparedCaptureWithWarnings(await prepareCapture(values));
}

export async function commitPreparedCapture(token: PreparedCapture) {
  return (await commitPreparedCaptureWithWarnings(token)).capture;
}

export async function commitPreparedCaptureWithWarnings(
  token: PreparedCapture,
) {
  const prepared = preparedCaptures.get(token);
  if (!prepared)
    throw new Error("A current screened capture preparation is required.");
  preparedCaptures.delete(token);
  const { values, sanitized, settings } = prepared;
  const sourceAccess = await getAccessibleSource(values.sourceId, "editor");
  const source =
    sourceAccess.resource as typeof schema.brainSources.$inferSelect;
  if (
    prepared.actor !== requireUserEmail().trim().toLowerCase() ||
    prepared.sourceRevision !== captureScreeningSourceRevision(source) ||
    prepared.settingsRevision !== stableJson(await readBrainSettings())
  ) {
    throw new Error(
      "Capture screening context changed. Screen the capture again before storing it.",
    );
  }
  const db = getDb();
  const now = nowIso();
  const id = values.id ?? nanoid();
  const existing = firstRow(
    values.externalId
      ? await db
          .select()
          .from(schema.brainRawCaptures)
          .where(
            and(
              eq(schema.brainRawCaptures.sourceId, values.sourceId),
              eq(schema.brainRawCaptures.externalId, values.externalId),
            ),
          )
          .limit(1)
      : [],
  );
  const existingRevision = existing ? stableJson(existing) : null;
  const upstreamDeletionReceipt = values.externalId
    ? await findUpstreamDeletionReceipt(values.sourceId, values.externalId)
    : null;
  if (upstreamDeletionReceipt)
    throw new BrainCaptureBlockedError(upstreamDeletionReceipt);
  if (
    prepared.preserveExistingKind &&
    existing &&
    existing.kind !== values.kind
  ) {
    throw new Error(
      "Capture kind changed during screening. Screen the capture again before storing it.",
    );
  }

  if (!sanitized.decision || sanitized.decision.disposition !== "allowed") {
    const receipt = await recordBlockedCapture({
      id,
      existing: existing ?? null,
      source,
      values,
      decision: sanitized.decision ?? {
        disposition: "quarantined",
        categories: [],
        confidenceBand: "uncertain",
        policyVersion: BRAIN_SENSITIVITY_POLICY_VERSION,
        safeSegments: [],
        safeContent: "",
        classifier: "deterministic",
      },
      classifierFailureReason: sanitized.classifierFailureReason,
      retentionHours: settings.quarantineRetentionHours ?? 72,
    });
    throw new BrainCaptureBlockedError(receipt);
  }
  const nextContentHash = await contentHash(sanitized.content);
  const previousMetadata = existing
    ? parseJson<Record<string, unknown>>(existing.metadataJson, {})
    : {};
  const nextMetadata = { ...sanitized.metadata };
  if (
    source.provider === "manual" &&
    values.externalId?.startsWith("markdown:") &&
    nextMetadata.participantsCount === undefined &&
    typeof previousMetadata.participantsCount === "number" &&
    Number.isInteger(previousMetadata.participantsCount) &&
    previousMetadata.participantsCount >= 0 &&
    previousMetadata.participantsCount <= 100
  ) {
    nextMetadata.participantsCount = previousMetadata.participantsCount;
  }
  delete nextMetadata.capturedAtExplicit;
  delete nextMetadata.capturedAtSource;
  if (
    source.provider === "manual" &&
    values.externalId?.startsWith("markdown:") &&
    ((values.capturedAt && values.capturedAtSource === "manual-markdown") ||
      (!values.capturedAt &&
        previousMetadata.capturedAtSource === "manual-markdown"))
  ) {
    nextMetadata.capturedAtSource = "manual-markdown";
  }
  const nextMetadataJson = stableJson(nextMetadata);
  const requestedCapturedAt = values.capturedAt ?? existing?.capturedAt ?? now;
  const nextCapturedAt =
    existing &&
    Number.isFinite(Date.parse(existing.capturedAt)) &&
    Date.parse(existing.capturedAt) === Date.parse(requestedCapturedAt)
      ? existing.capturedAt
      : requestedCapturedAt;
  const contentChanged = existing?.contentHash !== nextContentHash;
  const metadataChanged = Boolean(
    existing &&
    captureMetadataFingerprint(
      parseJson<Record<string, unknown>>(existing.metadataJson, {}),
    ) !== captureMetadataFingerprint(nextMetadata),
  );
  const indexedMetadataChanged = Boolean(
    existing &&
    (existing.title !== sanitized.title ||
      existing.kind !== values.kind ||
      existing.capturedAt !== nextCapturedAt),
  );
  const derivedInputChanged =
    !existing || contentChanged || metadataChanged || indexedMetadataChanged;
  const nextStatus =
    values.status ??
    (derivedInputChanged ? "queued" : (existing?.status ?? "queued"));
  const nextDistilledAt =
    values.status === "distilled"
      ? now
      : values.status !== undefined || derivedInputChanged
        ? null
        : (existing?.distilledAt ?? null);
  const captureId = existing?.id ?? id;
  let guardedRevision = existingRevision;
  try {
    if (!existing) {
      await db.insert(schema.brainRawCaptures).values({
        id,
        sourceId: values.sourceId,
        externalId: values.externalId ?? null,
        title: sanitized.title,
        kind: values.kind,
        content: sanitized.content,
        contentHash: nextContentHash,
        metadataJson: nextMetadataJson,
        capturedAt: nextCapturedAt,
        importedBy: requireUserEmail(),
        status: nextStatus,
        distilledAt: nextDistilledAt,
        sensitivityDisposition: "pending",
        sensitivityPolicyVersion: sanitized.decision.policyVersion,
        audienceAclHash: null,
        createdAt: now,
        updatedAt: now,
      });
      const inserted = firstRow(
        await db
          .select()
          .from(schema.brainRawCaptures)
          .where(eq(schema.brainRawCaptures.id, captureId))
          .limit(1),
      );
      if (!inserted) throw new BrainCaptureConcurrentError();
      guardedRevision = stableJson(inserted);
    }
  } catch (err) {
    if (!existing) {
      await db
        .delete(schema.brainCaptureAudiences)
        .where(eq(schema.brainCaptureAudiences.captureId, captureId));
    }
    if (values.externalId && isUniqueConflict(err)) {
      const raced = firstRow(
        await db
          .select()
          .from(schema.brainRawCaptures)
          .where(
            and(
              eq(schema.brainRawCaptures.sourceId, values.sourceId),
              eq(schema.brainRawCaptures.externalId, values.externalId),
            ),
          )
          .limit(1),
      );
      if (raced) throw new BrainCaptureConcurrentError();
    }
    throw err;
  }
  const racedDeletionReceipt = values.externalId
    ? await findUpstreamDeletionReceipt(values.sourceId, values.externalId)
    : null;
  if (racedDeletionReceipt) {
    await retireUpstreamDeletedCapture({
      sourceId: values.sourceId,
      externalId: values.externalId!,
      provider: source.provider as BrainSourceProvider,
    });
    throw new BrainCaptureBlockedError(racedDeletionReceipt);
  }
  const finalizationClauses = [eq(schema.brainRawCaptures.id, captureId)];
  if (values.externalId) {
    const locatorHmac = await upstreamDeletionLocatorHmac(
      values.sourceId,
      values.externalId,
    );
    finalizationClauses.push(
      notExists(
        db
          .select({ id: schema.brainSensitivityEvents.id })
          .from(schema.brainSensitivityEvents)
          .where(
            and(
              eq(schema.brainSensitivityEvents.locatorHmac, locatorHmac),
              eq(
                schema.brainSensitivityEvents.policyVersion,
                UPSTREAM_DELETED_POLICY_VERSION,
              ),
              eq(schema.brainSensitivityEvents.disposition, "suppressed"),
            ),
          ),
      ),
    );
  }
  const invalidatesDerived = Boolean(existing) && derivedInputChanged;
  const policyVersion = sanitized.decision.policyVersion;
  const audienceInvalidations: Array<() => Promise<AudienceInvalidationFlush>> =
    [];
  const {
    value: { result: finalized, audience, saved },
    effects,
  } = await transactWithResourceStore(
    db,
    invalidatesDerived && (await capturePublishesResources(captureId, db)),
    async (scoped, effects) => {
      audienceInvalidations.length = 0;
      const audienceInput = {
        captureId,
        source,
        kind: values.audience?.kind,
        memberEmails:
          values.audience?.memberEmails ??
          (source.visibility === "org" ? undefined : [source.ownerEmail]),
        upstreamRefHash: values.audience?.upstreamRefHash,
        deferInvalidations: audienceInvalidations,
      };
      await lockCaptureRows(
        [
          captureId,
          ...(await captureIdsAffectedByAudienceAssignment(
            audienceInput,
            scoped,
          )),
        ],
        scoped,
      );
      if (guardedRevision !== null || prepared.preserveExistingKind) {
        const current = firstRow(
          await scoped
            .select()
            .from(schema.brainRawCaptures)
            .where(eq(schema.brainRawCaptures.id, captureId))
            .limit(1),
        );
        if (
          guardedRevision !== null &&
          (!current || stableJson(current) !== guardedRevision)
        )
          throw new BrainCaptureConcurrentError();
        if (
          prepared.preserveExistingKind &&
          (!current || current.kind !== values.kind)
        ) {
          throw new Error(
            "Capture kind changed during screening. Screen the capture again before storing it.",
          );
        }
      }
      const audience = await ensureCaptureAudience(audienceInput);
      const result = (await scoped
        .update(schema.brainRawCaptures)
        .set({
          title: sanitized.title,
          kind: values.kind,
          content: sanitized.content,
          contentHash: nextContentHash,
          metadataJson: nextMetadataJson,
          capturedAt: nextCapturedAt,
          status: nextStatus,
          distilledAt: nextDistilledAt,
          sensitivityDisposition: "allowed",
          sensitivityPolicyVersion: policyVersion,
          audienceAclHash: audience.aclHash,
          updatedAt: now,
        })
        .where(and(...finalizationClauses))) as { rowsAffected: number };
      if (
        invalidatesDerived &&
        !(result.rowsAffected === 0 && values.externalId)
      )
        await invalidateDerivedForLockedCapture(captureId, scoped, effects);
      const saved = firstRow(
        await scoped
          .select()
          .from(schema.brainRawCaptures)
          .where(eq(schema.brainRawCaptures.id, captureId))
          .limit(1),
      );
      return { result, audience, saved };
    },
  );
  const committedEffects = await runAfterCommitEffects(effects);
  let failedInvalidations = 0;
  let failedNotifications = committedEffects.failedNotifications;
  for (const flush of audienceInvalidations) {
    const flushed = await flush();
    failedInvalidations += flushed.failedInvalidations;
    failedNotifications += flushed.failedNotifications;
  }
  let failedIndexing = 0;
  const warningsNow = () =>
    postCommitWarnings({
      failedNotifications,
      failedInvalidations,
      failedIndexing,
    });
  if (finalized.rowsAffected === 0 && values.externalId) {
    await db
      .delete(schema.brainCaptureAudiences)
      .where(eq(schema.brainCaptureAudiences.captureId, captureId));
    await retireUpstreamDeletedCapture({
      sourceId: values.sourceId,
      externalId: values.externalId,
      provider: source.provider as BrainSourceProvider,
    });
    const receipt = await findUpstreamDeletionReceipt(
      values.sourceId,
      values.externalId,
    );
    if (receipt) throw new BrainCaptureBlockedError(receipt);
    throw new Error("Capture finalization was blocked");
  }
  const capture = saved;
  if (!capture) throw new BrainCaptureConcurrentError();
  const invalidationReason = derivedInputChanged
    ? "content-changed"
    : existing.audienceAclHash !== audience.aclHash
      ? "access-changed"
      : existing.sensitivityPolicyVersion !== sanitized.decision.policyVersion
        ? "sensitivity-changed"
        : null;
  if (!invalidationReason) {
    return { capture, ...warningsNow() };
  }
  try {
    await enqueueCaptureInvalidation({
      captureId,
      sourceId: source.id,
      reason: invalidationReason,
      previous: existing
        ? {
            contentHash: existing.contentHash ?? undefined,
            sensitivityPolicyVersion:
              existing.sensitivityPolicyVersion ?? undefined,
            aclHash: existing.audienceAclHash ?? undefined,
          }
        : undefined,
      next: {
        contentHash: nextContentHash,
        sensitivityPolicyVersion: sanitized.decision.policyVersion,
        aclHash: audience.aclHash,
      },
    });
  } catch (error) {
    failedIndexing += 1;
    console.warn(
      "[brain] Queueing the search index refresh failed after the capture committed:",
      error instanceof Error ? error.message : "unknown error",
    );
    try {
      const { unindexBrainCapture } = await import("./search-index.js");
      await unindexBrainCapture(captureId);
    } catch (unindexError) {
      console.warn(
        "[brain] Removing the stale search entry failed after the capture committed:",
        unindexError instanceof Error ? unindexError.message : "unknown error",
      );
    }
  }
  return { capture, ...warningsNow() };
}

export interface BrainSensitivityReceipt {
  id: string;
  sourceId: string;
  disposition: "suppressed" | "quarantined";
  categories: BrainSensitivityDecision["categories"];
  confidenceBand: BrainSensitivityDecision["confidenceBand"];
  policyVersion: string;
  expiresAt: string | null;
}

export class BrainCaptureConcurrentError extends Error {
  constructor() {
    super("Capture changed concurrently. Retry the import.");
    this.name = "BrainCaptureConcurrentError";
  }
}

export class BrainCaptureBlockedError extends Error {
  constructor(public readonly receipt: BrainSensitivityReceipt) {
    super(`Capture ${receipt.disposition} by Brain privacy policy`);
    this.name = "BrainCaptureBlockedError";
  }
}

export async function retireUpstreamDeletedCapture(input: {
  sourceId: string;
  externalId: string;
  provider: BrainSourceProvider;
}) {
  const db = getDb();
  const now = nowIso();
  const locatorHmac = await upstreamDeletionLocatorHmac(
    input.sourceId,
    input.externalId,
  );
  const eventId = `sensitivity_${nanoid(18)}`;
  const emptyContentHash = await contentHash("");
  const captureBeforeRetirement = firstRow(
    await db
      .select({ id: schema.brainRawCaptures.id })
      .from(schema.brainRawCaptures)
      .where(
        and(
          eq(schema.brainRawCaptures.sourceId, input.sourceId),
          eq(schema.brainRawCaptures.externalId, input.externalId),
        ),
      )
      .limit(1),
  );
  let capture:
    | {
        id: string;
        contentHash: string | null;
        sensitivityPolicyVersion: string | null;
        audienceAclHash: string | null;
      }
    | undefined;
  const { effects } = await transactWithResourceStore(
    db,
    captureBeforeRetirement
      ? await capturePublishesResources(captureBeforeRetirement.id, db)
      : false,
    async (tx, effects) => {
      if (captureBeforeRetirement)
        await lockCaptureRows([captureBeforeRetirement.id], tx);
      await tx
        .insert(schema.brainSensitivityEvents)
        .values({
          id: eventId,
          sourceId: input.sourceId,
          captureId: null,
          locatorHmac,
          disposition: "suppressed",
          categoriesJson: "[]",
          confidenceBand: "deterministic",
          policyVersion: UPSTREAM_DELETED_POLICY_VERSION,
          upstreamProvider: input.provider,
          quarantineBlobHandle: null,
          expiresAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.brainSensitivityEvents.locatorHmac,
            schema.brainSensitivityEvents.policyVersion,
          ],
          set: {
            disposition: "suppressed",
            quarantineBlobHandle: null,
            expiresAt: null,
            updatedAt: now,
          },
        });
      capture = firstRow(
        await tx
          .select({
            id: schema.brainRawCaptures.id,
            contentHash: schema.brainRawCaptures.contentHash,
            sensitivityPolicyVersion:
              schema.brainRawCaptures.sensitivityPolicyVersion,
            audienceAclHash: schema.brainRawCaptures.audienceAclHash,
          })
          .from(schema.brainRawCaptures)
          .where(
            and(
              eq(schema.brainRawCaptures.sourceId, input.sourceId),
              eq(schema.brainRawCaptures.externalId, input.externalId),
            ),
          )
          .limit(1),
      );
      if (!capture) return;
      if (capture.id !== captureBeforeRetirement?.id)
        await lockCaptureRows([capture.id], tx as unknown as DbHandle);

      await tx
        .update(schema.brainSensitivityEvents)
        .set({ captureId: capture.id, updatedAt: now })
        .where(
          and(
            eq(schema.brainSensitivityEvents.locatorHmac, locatorHmac),
            eq(
              schema.brainSensitivityEvents.policyVersion,
              UPSTREAM_DELETED_POLICY_VERSION,
            ),
          ),
        );
      await tx
        .update(schema.brainRawCaptures)
        .set({
          title: "Deleted upstream capture",
          content: "",
          contentHash: emptyContentHash,
          metadataJson: "{}",
          status: "ignored",
          sensitivityDisposition: "pending",
          audienceAclHash: null,
          updatedAt: now,
        })
        .where(eq(schema.brainRawCaptures.id, capture.id));
      await tx
        .delete(schema.brainCaptureAudiences)
        .where(eq(schema.brainCaptureAudiences.captureId, capture.id));
      await invalidateDerivedForCapture(capture.id, tx, { effects });
    },
  );
  await runAfterCommitEffects(effects);
  if (!capture) return false;
  await enqueueCaptureInvalidation({
    captureId: capture.id,
    sourceId: input.sourceId,
    reason: "upstream-deleted",
    previous: {
      contentHash: capture.contentHash ?? undefined,
      sensitivityPolicyVersion: capture.sensitivityPolicyVersion ?? undefined,
      aclHash: capture.audienceAclHash ?? undefined,
    },
  });
  return true;
}

function privateQuarantineProvider(provider: BrainSourceProvider) {
  return provider === "generic" || provider === "clips";
}

async function deleteQuarantineHandle(value: string | null | undefined) {
  if (!value) return;
  try {
    await deletePrivateBlob(JSON.parse(value) as PrivateBlobHandle);
  } catch {}
}

type DbHandle = ReturnType<typeof getDb>;

export interface AfterCommitEffects {
  resourceStoreReady: boolean;
  readonly pending: Array<() => void | Promise<void>>;
}

function createAfterCommitEffects(
  resourceStoreReady = false,
): AfterCommitEffects {
  return { resourceStoreReady, pending: [] };
}

class ResourceStoreNotReadyError extends Error {
  constructor() {
    super(
      "The resource store must be initialized before the Brain transaction opens.",
    );
  }
}

async function prepareAfterCommitEffects(
  needsResourceStore: boolean,
): Promise<AfterCommitEffects> {
  if (needsResourceStore) await ensureResourceStoreReady();
  return createAfterCommitEffects(needsResourceStore);
}

export async function transactWithResourceStore<T>(
  db: DbHandle,
  needsResourceStore: boolean,
  work: (scoped: DbHandle, effects: AfterCommitEffects) => Promise<T>,
): Promise<{ value: T; effects: AfterCommitEffects }> {
  const attempt = async (effects: AfterCommitEffects) => ({
    value: await db.transaction((tx) =>
      work(tx as unknown as DbHandle, effects),
    ),
    effects,
  });
  const first = await prepareAfterCommitEffects(needsResourceStore);
  try {
    return await attempt(first);
  } catch (error) {
    if (!(error instanceof ResourceStoreNotReadyError)) throw error;
    return attempt(await prepareAfterCommitEffects(true));
  }
}

async function capturePublishesResources(captureId: string, db: DbHandle) {
  return (await knowledgeCitingCapture(captureId, db)).some(
    (row) => row.publishedResourcePath,
  );
}

export async function runAfterCommitEffects(
  effects: AfterCommitEffects,
): Promise<{ failedNotifications: number }> {
  let failedNotifications = 0;
  for (const run of effects.pending.splice(0)) {
    try {
      await run();
    } catch (error) {
      failedNotifications += 1;
      console.warn(
        "[brain] A post-commit notification failed after the write committed:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
  return { failedNotifications };
}

export function postCommitWarnings(result: {
  failedNotifications: number;
  failedInvalidations?: number;
  failedIndexing?: number;
}) {
  const warnings: string[] = [];
  if (result.failedNotifications)
    warnings.push(
      "The change was saved, but a follow-up notification could not be sent. Do not repeat the write.",
    );
  if (result.failedInvalidations)
    warnings.push(
      "The capture and its audience were saved, but refreshing knowledge derived from other captures that share the changed audience did not finish. Access is already enforced from the saved audience; that derived knowledge may refresh later.",
    );
  if (result.failedIndexing)
    warnings.push(
      "The capture was saved, but queueing its search index refresh failed, so search may show stale or no text for it until it is reindexed. Do not repeat the write.",
    );
  return warnings.length ? { postCommitWarnings: warnings } : {};
}

function requireResourceStore(effects: AfterCommitEffects) {
  if (!effects.resourceStoreReady) throw new ResourceStoreNotReadyError();
}

async function deleteCanonicalResourceInTransaction(
  path: string,
  effects: AfterCommitEffects,
) {
  requireResourceStore(effects);
  const exec = getDbExec();
  const { rows } = await exec.execute({
    sql: "SELECT id FROM resources WHERE owner = ? AND path = ?",
    args: [SHARED_OWNER, path],
  });
  const id = rows[0]?.id;
  if (typeof id !== "string") return;
  const write = await resourceDeleteWithDb(exec, id);
  effects.pending.push(write.notifyAfterCommit);
}

export async function lockCaptureRows(
  captureIds: Iterable<string>,
  db: DbHandle = getDb(),
) {
  const ids = [...new Set(captureIds)].sort();
  if (!ids.length) return;
  await db
    .select({ id: schema.brainRawCaptures.id })
    .from(schema.brainRawCaptures)
    .where(inArray(schema.brainRawCaptures.id, ids))
    .orderBy(asc(schema.brainRawCaptures.id))
    .for("update");
}

export async function lockKnowledgeRows(
  knowledgeIds: Iterable<string>,
  db: DbHandle = getDb(),
) {
  const ids = [...new Set(knowledgeIds)].sort();
  if (!ids.length) return;
  await db
    .select({ id: schema.brainKnowledge.id })
    .from(schema.brainKnowledge)
    .where(inArray(schema.brainKnowledge.id, ids))
    .orderBy(asc(schema.brainKnowledge.id))
    .for("update");
}

async function knowledgeCitingCapture(captureId: string, db: DbHandle) {
  return db
    .select({
      id: schema.brainKnowledge.id,
      publishedResourcePath: schema.brainKnowledge.publishedResourcePath,
      updatedAt: schema.brainKnowledge.updatedAt,
    })
    .from(schema.brainKnowledge)
    .where(
      or(
        eq(schema.brainKnowledge.captureId, captureId),
        like(schema.brainKnowledge.evidenceJson, `%${captureId}%`),
      ),
    )
    .orderBy(asc(schema.brainKnowledge.id));
}

export async function invalidateDerivedForCapture(
  captureId: string,
  db: DbHandle = getDb(),
  options: { effects?: AfterCommitEffects } = {},
) {
  if (options.effects) {
    await invalidateDerivedForLockedCapture(captureId, db, options.effects);
    return { failedNotifications: 0 };
  }
  const { effects } = await transactWithResourceStore(
    db,
    await capturePublishesResources(captureId, db),
    async (scoped, effects) => {
      await lockCaptureRows([captureId], scoped);
      await invalidateDerivedForLockedCapture(captureId, scoped, effects);
    },
  );
  return runAfterCommitEffects(effects);
}

async function invalidateDerivedForLockedCapture(
  captureId: string,
  db: DbHandle,
  effects: AfterCommitEffects,
) {
  const needle = `%${captureId}%`;
  const knowledge = await knowledgeCitingCapture(captureId, db);
  await lockKnowledgeRows(
    knowledge.map((row) => row.id),
    db,
  );
  for (const row of knowledge) {
    if (row.publishedResourcePath)
      await deleteCanonicalResourceInTransaction(
        row.publishedResourcePath,
        effects,
      );
  }
  const idsByUpdatedAt = new Map<string, string[]>();
  for (const row of knowledge) {
    const updatedAt = nextKnowledgeUpdatedAt(row.updatedAt);
    idsByUpdatedAt.set(updatedAt, [
      ...(idsByUpdatedAt.get(updatedAt) ?? []),
      row.id,
    ]);
  }
  for (const [updatedAt, ids] of idsByUpdatedAt) {
    await db
      .update(schema.brainKnowledge)
      .set({
        title: "Redacted Brain knowledge",
        summary: "",
        body: "",
        evidenceJson: "[]",
        status: "redacted",
        publishedResourcePath: null,
        updatedAt,
      })
      .where(inArray(schema.brainKnowledge.id, ids));
  }
  const proposals = await db
    .select({ id: schema.brainProposals.id })
    .from(schema.brainProposals)
    .where(
      or(
        eq(schema.brainProposals.captureId, captureId),
        like(schema.brainProposals.evidenceJson, needle),
      ),
    );
  if (proposals.length) {
    await db
      .update(schema.brainProposals)
      .set({
        title: "Redacted Brain proposal",
        body: "",
        rationale: "",
        payloadJson: "{}",
        evidenceJson: "[]",
        status: "rejected",
        updatedAt: nowIso(),
      })
      .where(
        inArray(
          schema.brainProposals.id,
          proposals.map((row) => row.id),
        ),
      );
  }
}

async function discardUnreferencedQuarantineBlob(
  db: DbHandle,
  eventLocator: ReturnType<typeof and>,
  handle: string | null,
) {
  if (!handle) return;
  try {
    const event = firstRow(
      await db
        .select({
          quarantineBlobHandle:
            schema.brainSensitivityEvents.quarantineBlobHandle,
        })
        .from(schema.brainSensitivityEvents)
        .where(eventLocator)
        .limit(1),
    );
    if (event?.quarantineBlobHandle === handle) return;
  } catch (error) {
    console.warn(
      "[brain] Checking whether the quarantine blob is referenced failed; deleting it:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
  await deleteQuarantineHandle(handle);
}

export async function recordBlockedCapture(input: {
  id: string;
  existing: typeof schema.brainRawCaptures.$inferSelect | null;
  source: typeof schema.brainSources.$inferSelect;
  values: Parameters<typeof createCapture>[0];
  decision: BrainSensitivityDecision;
  classifierFailureReason?: string;
  retentionHours: number;
}): Promise<BrainSensitivityReceipt> {
  const db = getDb();
  const now = nowIso();
  const locatorHmac = await sha256Hex(
    `${input.source.id}\0${input.values.externalId ?? (await contentHash(input.values.content))}`,
  );
  const prior = firstRow(
    await db
      .select({
        id: schema.brainSensitivityEvents.id,
        quarantineBlobHandle:
          schema.brainSensitivityEvents.quarantineBlobHandle,
      })
      .from(schema.brainSensitivityEvents)
      .where(
        and(
          eq(schema.brainSensitivityEvents.locatorHmac, locatorHmac),
          eq(
            schema.brainSensitivityEvents.policyVersion,
            input.decision.policyVersion,
          ),
        ),
      )
      .limit(1),
  );
  let disposition: "suppressed" | "quarantined" =
    input.decision.disposition === "suppressed" ? "suppressed" : "quarantined";
  let quarantineBlobHandle: string | null = null;
  let expiresAt: string | null = null;
  if (
    disposition === "quarantined" &&
    privateQuarantineProvider(input.source.provider as BrainSourceProvider)
  ) {
    const handle = await putPrivateBlob({
      data: new TextEncoder().encode(encryptSecretValue(input.values.content)),
      filename: `brain-quarantine-${input.id}.bin`,
      mimeType: "application/octet-stream",
      ownerEmail: input.source.ownerEmail,
      metadata: { app: "brain", kind: "privacy-quarantine" },
    });
    if (handle) {
      quarantineBlobHandle = stableJson(handle);
      expiresAt = new Date(
        Date.parse(now) +
          Math.max(1, Math.min(168, input.retentionHours)) * 60 * 60 * 1000,
      ).toISOString();
    } else {
      disposition = "suppressed";
    }
  }
  const eventId = prior?.id ?? `sensitivity_${nanoid(18)}`;
  const eventLocator = and(
    eq(schema.brainSensitivityEvents.locatorHmac, locatorHmac),
    eq(
      schema.brainSensitivityEvents.policyVersion,
      input.decision.policyVersion,
    ),
  );
  const eventValues = {
    captureId: input.existing?.id ?? null,
    disposition,
    categoriesJson: stableJson(input.decision.categories),
    decisionScoresJson: input.decision.categoryScores
      ? stableJson(input.decision.categoryScores)
      : null,
    classifierFailureReason: input.classifierFailureReason ?? null,
    confidenceBand: input.decision.confidenceBand,
    quarantineBlobHandle,
    expiresAt,
    updatedAt: now,
  };
  const readEventHandle = async (scoped: DbHandle) =>
    firstRow(
      await scoped
        .select({
          id: schema.brainSensitivityEvents.id,
          quarantineBlobHandle:
            schema.brainSensitivityEvents.quarantineBlobHandle,
        })
        .from(schema.brainSensitivityEvents)
        .where(eventLocator)
        .limit(1),
    );
  const writeSensitivityEvent = async (
    scoped: DbHandle,
  ): Promise<{ id: string; displacedHandle: string | null }> => {
    const insertEvent = () =>
      scoped
        .insert(schema.brainSensitivityEvents)
        .values({
          id: eventId,
          sourceId: input.source.id,
          locatorHmac,
          policyVersion: input.decision.policyVersion,
          upstreamProvider: input.source.provider,
          createdAt: now,
          ...eventValues,
        })
        .onConflictDoNothing({
          target: [
            schema.brainSensitivityEvents.locatorHmac,
            schema.brainSensitivityEvents.policyVersion,
          ],
        })
        .returning({ id: schema.brainSensitivityEvents.id });
    const overwrite = (where: ReturnType<typeof and>) =>
      scoped
        .update(schema.brainSensitivityEvents)
        .set({ ...eventValues, reviewedBy: null, reviewedAt: null })
        .where(where)
        .returning({ id: schema.brainSensitivityEvents.id });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const inserted = await insertEvent();
      if (inserted.length) return { id: eventId, displacedHandle: null };
      const current = await readEventHandle(scoped);
      if (!current) continue;
      const applied = await overwrite(
        and(
          eventLocator,
          current.quarantineBlobHandle === null
            ? isNull(schema.brainSensitivityEvents.quarantineBlobHandle)
            : eq(
                schema.brainSensitivityEvents.quarantineBlobHandle,
                current.quarantineBlobHandle,
              ),
        ),
      );
      if (applied.length)
        return {
          id: current.id,
          displacedHandle: current.quarantineBlobHandle,
        };
    }
    throw new BrainCaptureConcurrentError();
  };
  let effects: AfterCommitEffects | undefined;
  let written: { id: string; displacedHandle: string | null };
  try {
    if (input.existing) {
      const existingId = input.existing.id;
      const existingRevision = stableJson(input.existing);
      const blockedContentHash = await contentHash("");
      let result: { id: string; displacedHandle: string | null } | undefined;
      ({ effects } = await transactWithResourceStore(
        db,
        await capturePublishesResources(existingId, db),
        async (scoped, effects) => {
          await lockCaptureRows([existingId], scoped);
          const current = firstRow(
            await scoped
              .select()
              .from(schema.brainRawCaptures)
              .where(eq(schema.brainRawCaptures.id, existingId))
              .limit(1),
          );
          if (!current || stableJson(current) !== existingRevision)
            throw new BrainCaptureConcurrentError();
          result = await writeSensitivityEvent(scoped);
          await invalidateDerivedForLockedCapture(existingId, scoped, effects);
          await scoped
            .update(schema.brainRawCaptures)
            .set({
              title: "Privacy-blocked capture",
              content: "",
              contentHash: blockedContentHash,
              metadataJson: "{}",
              status: "ignored",
              sensitivityDisposition: "pending",
              sensitivityPolicyVersion: input.decision.policyVersion,
              audienceAclHash: null,
              updatedAt: now,
            })
            .where(eq(schema.brainRawCaptures.id, existingId));
        },
      ));
      if (!result) throw new BrainCaptureConcurrentError();
      written = result;
    } else {
      written = await writeSensitivityEvent(db);
    }
  } catch (error) {
    await discardUnreferencedQuarantineBlob(
      db,
      eventLocator,
      quarantineBlobHandle,
    );
    throw error;
  }
  await deleteQuarantineHandle(written.displacedHandle);
  if (input.existing && effects) {
    await runAfterCommitEffects(effects);
    await enqueueBrainOperation({
      operation: "search-unindex",
      dedupeKey: `search-unindex:${input.existing.id}:${input.decision.policyVersion}`,
      sourceId: input.source.id,
      captureId: input.existing.id,
      priority: 1,
    });
  }
  return {
    id: written.id,
    sourceId: input.source.id,
    disposition,
    categories: input.decision.categories,
    confidenceBand: input.decision.confidenceBand,
    policyVersion: input.decision.policyVersion,
    expiresAt,
  };
}

export async function expireSensitivityQuarantines(at = nowIso()) {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.brainSensitivityEvents.id,
      quarantineBlobHandle: schema.brainSensitivityEvents.quarantineBlobHandle,
    })
    .from(schema.brainSensitivityEvents)
    .where(
      and(
        eq(schema.brainSensitivityEvents.disposition, "quarantined"),
        lte(schema.brainSensitivityEvents.expiresAt, at),
      ),
    );
  for (const row of rows) {
    await deleteQuarantineHandle(row.quarantineBlobHandle);
  }
  let expired = 0;
  for (const row of rows) {
    const cleared = await db
      .update(schema.brainSensitivityEvents)
      .set({
        disposition: "expired",
        quarantineBlobHandle: null,
        expiresAt: null,
        updatedAt: at,
      })
      .where(
        and(
          eq(schema.brainSensitivityEvents.id, row.id),
          eq(schema.brainSensitivityEvents.disposition, "quarantined"),
          row.quarantineBlobHandle === null
            ? isNull(schema.brainSensitivityEvents.quarantineBlobHandle)
            : eq(
                schema.brainSensitivityEvents.quarantineBlobHandle,
                row.quarantineBlobHandle,
              ),
        ),
      )
      .returning({ id: schema.brainSensitivityEvents.id });
    if (cleared.length) expired += 1;
  }
  return expired;
}

export class EvidenceInputError extends Error {}

export class EvidenceQuoteMismatchError extends EvidenceInputError {
  constructor(captureId: string) {
    super(`Evidence quote is not an exact substring of capture ${captureId}`);
    this.name = "EvidenceQuoteMismatchError";
  }
}

export async function validateEvidenceWithContent(
  evidence: BrainEvidenceInput[],
  options: { reusingStoredEvidence?: boolean } = {},
): Promise<{ evidence: BrainEvidence[]; content: Map<string, string> }> {
  const validated: BrainEvidence[] = [];
  const content = new Map<string, string>();
  for (const item of evidence) {
    const access = await getAccessibleCapture(item.captureId);
    if (!access)
      throw new EvidenceInputError(`No access to capture ${item.captureId}`);
    const quote = item.quote.trim();
    if (!quote) throw new EvidenceInputError("Evidence quote cannot be empty");
    if (!access.capture.content.includes(quote)) {
      throw new EvidenceQuoteMismatchError(item.captureId);
    }
    content.set(item.captureId, access.capture.content);
    const metadata = parseJson<Record<string, unknown>>(
      withOmissionReceipt(
        access.capture.metadataJson,
        access.capture.content,
        access.capture.kind,
      ),
      {},
    );
    const sourceUrl =
      readWithheldPassages(metadata) === undefined
        ? safeCitationUrl(item.sourceUrl ?? item.url ?? metadata.sourceUrl)
        : null;
    const storedDateKept =
      !options.reusingStoredEvidence ||
      typeof (item as { capturedAt?: unknown }).capturedAt === "string";
    const result: BrainEvidence = {
      captureId: item.captureId,
      sourceId: access.capture.sourceId,
      captureTitle: access.capture.title,
      quote,
      ...(storedDateKept &&
      access.source.provider === "manual" &&
      access.capture.externalId?.startsWith("markdown:") &&
      metadata.capturedAtSource === "manual-markdown" &&
      !Number.isNaN(Date.parse(access.capture.capturedAt))
        ? {
            capturedAt: access.capture.capturedAt,
            capturedAtSource: "manual-markdown" as const,
          }
        : {}),
      note: item.note,
      timestampMs: item.timestampMs,
    };
    if (sourceUrl) result.sourceUrl = sourceUrl;
    validated.push(result);
  }
  return { evidence: validated, content };
}

export async function validateEvidence(
  evidence: BrainEvidenceInput[],
): Promise<BrainEvidence[]> {
  return (await validateEvidenceWithContent(evidence)).evidence;
}

export function visibilityForTier(
  tier: BrainPublishTier,
): "private" | "org" | "public" {
  if (tier === "private") return "private";
  return "org";
}

export function publishedKnowledgeStatusClause() {
  const published = or(
    eq(schema.brainKnowledge.status, "published"),
    and(
      eq(schema.brainKnowledge.status, "redacted"),
      ne(schema.brainKnowledge.publishTier, "private"),
    ),
  );
  if (!published) throw new Error("The published status clause is empty.");
  return published;
}

export function statusForTier(tier: BrainPublishTier): BrainKnowledgeStatus {
  return tier === "private" ? "draft" : "published";
}

const MAX_DESTINATION_DECODE_PASSES = 8;

function decodedForms(value: string) {
  const forms = [value];
  let current = value;
  for (let pass = 0; pass < MAX_DESTINATION_DECODE_PASSES; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      next = current.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
    }
    if (next === current) return { forms, stable: true };
    forms.push(next);
    current = next;
  }
  return { forms, stable: false };
}

function destinationRevealsRedaction(
  destination: string,
  redact: (value: string) => string,
) {
  const { forms, stable } = decodedForms(destination);
  return !stable || forms.some((form) => redact(form) !== form);
}

export function applyRedactions(values: {
  title: string;
  body: string;
  summary?: string;
  topic?: string | null | undefined;
  tags?: string[];
  entities?: Array<{ type: string; name: string }>;
  evidence: BrainEvidence[];
  redactions?: string[];
  autoRedactEmails?: boolean;
}) {
  const explicit = (values.redactions ?? [])
    .map((r) => r.trim())
    .filter(Boolean);
  const patterns: RegExp[] = [];
  for (const item of explicit) {
    patterns.push(new RegExp(escapeRegExp(item), "g"));
  }
  if (values.autoRedactEmails) {
    patterns.push(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  }
  let changed = false;
  const redact = (text: string) =>
    patterns.reduce(
      (next, pattern) =>
        next.replace(pattern, () => {
          changed = true;
          return "[redacted]";
        }),
      text,
    );
  return {
    title: redact(values.title),
    body: redact(values.body),
    summary: values.summary ? redact(values.summary) : "",
    topic: values.topic ? redact(values.topic) : (values.topic ?? null),
    tags: (values.tags ?? []).map((tag) => redact(tag)),
    entities: (values.entities ?? []).map((entity) => ({
      type: redact(entity.type),
      name: redact(entity.name),
    })),
    evidence: sanitizeEvidenceCitationUrls(
      values.evidence.map((item) => ({
        ...item,
        quote: redact(item.quote),
        captureTitle: redact(item.captureTitle),
        note: item.note ? redact(item.note) : item.note,
      })),
    ).map((item) => {
      const next = { ...item };
      if (next.capturedAt && explicit.length > 0) {
        changed = true;
        delete next.capturedAt;
        delete next.capturedAtSource;
      }
      for (const key of ["sourceUrl", "url"] as const) {
        const destination = next[key];
        if (destination && destinationRevealsRedaction(destination, redact)) {
          delete next[key];
        }
      }
      return next;
    }),
    redacted: changed,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface WriteKnowledgeInput {
  knowledgeId?: string;
  expectedRevision?: string | undefined;
  title: string;
  body: string;
  kind?: BrainKnowledgeKind;
  summary?: string;
  topic?: string | null;
  tags?: string[];
  entities?: Array<{ type: string; name: string }>;
  evidence?: BrainEvidenceInput[];
  confidence?: number;
  publishTier?: BrainPublishTier;
  supersedesId?: string;
  supersedesRevision?: string | undefined;
  rationale?: string;
  redactions?: string[];
  publishCanonical?: boolean;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "knowledge"
  );
}

export interface BrainCanonicalResourcePreview {
  source: "knowledge" | "proposal";
  knowledgeId: string | null;
  proposalId?: string | null;
  title: string;
  path: string;
  pathExact: boolean;
  contentType: "text/markdown";
  markdown: string;
  canPublish: boolean;
  alreadyPublishedPath?: string | null;
  revision?: string;
  warnings: string[];
}

interface CanonicalResourceValues {
  id?: string | null;
  title: string;
  summary?: string | null;
  body: string;
  topic?: string | null;
  tags?: string[];
  evidence: BrainEvidence[];
}

export function buildCanonicalKnowledgePath(title: string, id?: string | null) {
  const suffix = id?.trim() || "<new-id>";
  return `context/company-brain/${slugify(title)}-${suffix}.md`;
}

export function buildCanonicalKnowledgeMarkdown(
  values: CanonicalResourceValues,
) {
  const citations = values.evidence
    .map((item, index) => {
      const sourceUrl = safeCitationUrl(item.sourceUrl ?? item.url);
      const where = sourceUrl ? ` (${sourceUrl})` : "";
      const captureTitle = item.captureTitle || item.captureId || "Source";
      return `${index + 1}. ${captureTitle}${where}: "${item.quote}"`;
    })
    .join("\n");
  return [
    `# ${values.title}`,
    values.summary ? `\n${values.summary}` : "",
    `\n${values.body}`,
    values.topic ? `\nTopic: ${values.topic}` : "",
    values.tags?.length ? `\nTags: ${values.tags.join(", ")}` : "",
    citations ? `\n## Citations\n${citations}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCanonicalResource(values: CanonicalResourceValues) {
  return {
    path: buildCanonicalKnowledgePath(values.title, values.id),
    pathExact: Boolean(values.id),
    markdown: buildCanonicalKnowledgeMarkdown(values),
    contentType: "text/markdown" as const,
  };
}

function sourceUrlFromCaptureMetadata(metadataJson: string) {
  const metadata = parseJson<Record<string, unknown>>(metadataJson, {});
  return sourceUrlFromMetadataRecord(metadata);
}

async function publishKnowledgeResourceInTransaction(
  knowledgeId: string,
  resource: ReturnType<typeof buildCanonicalResource>,
  effects: AfterCommitEffects,
) {
  requireResourceStore(effects);
  const write = await resourcePutWithDb(
    getDbExec(),
    SHARED_OWNER,
    resource.path,
    resource.markdown,
    "text/markdown",
    {
      createdBy: "agent",
      visibility: "workspace",
      metadata: {
        app: "brain",
        type: "company-brain-knowledge",
        knowledgeId,
      },
    },
  );
  effects.pending.push(write.notifyAfterCommit);
  return resource.path;
}

async function canPublishCanonicalAudience(audienceId: string | null) {
  if (!audienceId) return true;
  const [audience] = await getDb()
    .select({ kind: schema.brainAudiences.kind })
    .from(schema.brainAudiences)
    .where(eq(schema.brainAudiences.id, audienceId))
    .limit(1);
  return audience?.kind === "org";
}

export async function setKnowledgeCanonicalResource(
  knowledgeId: string,
  published: boolean,
  expectedRevision?: string,
) {
  const peeked = await peekKnowledgeRow(knowledgeId);
  const { value: knowledge, effects } = await transactWithResourceStore(
    getDb(),
    mayTouchCanonicalResource(peeked, published),
    async (_scoped, effects) => {
      const { evidenceLocked } = await lockKnowledgeWriteSet({
        knowledgeId,
        evidence: [],
      });
      const access = await assertAccess(
        "brain-knowledge",
        knowledgeId,
        "editor",
      );
      const row: KnowledgeRow = access.resource;
      await assertDerivedAudienceAccess(row);
      if (published && row.intelligenceKind) {
        fail(
          "Structured intelligence requires live evidence checks and cannot be mirrored to shared workspace context.",
          { errorCode: "intelligence_canonical_forbidden", statusCode: 403 },
        );
      }
      if (published) {
        if (!(await canPublishCanonicalAudience(row.audienceId))) {
          throw new Error(
            "Audience-restricted Brain knowledge cannot become workspace-wide canonical context.",
          );
        }
        if (row.status !== "published") {
          throw new Error(
            "Only published Brain knowledge can become company context.",
          );
        }
      }
      const resource = buildCanonicalResource(
        canonicalValuesFromKnowledgeRow(row),
      );
      const stored = published
        ? await canonicalMirrorIsCurrent(
            row.publishedResourcePath,
            resource,
            effects,
          )
        : row.publishedResourcePath === null;
      const decision = await decideKnowledgeSave({
        record: "knowledge",
        expectedRevision,
        requireRevision: true,
        row,
        current: serializeKnowledge(row),
        evidenceLocked,
        alreadyStored: async () => stored && !published,
      });
      if (decision === "already_applied" || stored)
        return serializeKnowledge(row);

      const publishedResourcePath = published
        ? await publishKnowledgeResourceInTransaction(row.id, resource, effects)
        : null;
      if (
        row.publishedResourcePath &&
        row.publishedResourcePath !== publishedResourcePath
      ) {
        await deleteCanonicalResourceInTransaction(
          row.publishedResourcePath,
          effects,
        );
      }
      const written = await getDb()
        .update(schema.brainKnowledge)
        .set({
          publishedResourcePath,
          updatedAt: nextKnowledgeUpdatedAt(row.updatedAt),
        })
        .where(knowledgeRowUnchanged(row))
        .returning();
      const changed = changedRowCount(written);
      if (changed === 0) throw await currentKnowledgeConflict(knowledgeId);
      if (changed > 1)
        throw new Error(
          `Save of knowledge ${knowledgeId} changed ${changed} rows.`,
        );
      countSaveOutcome("knowledge", "written");
      const updated = firstRow(written);
      if (!updated) throw new Error("Knowledge row vanished during the update");
      return serializeKnowledge(updated);
    },
  );
  return {
    ...knowledge,
    ...postCommitWarnings(await runAfterCommitEffects(effects)),
  };
}

function canonicalValuesFromKnowledgeRow(
  row: typeof schema.brainKnowledge.$inferSelect,
): CanonicalResourceValues {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    topic: row.topic,
    tags: parseJson<string[]>(row.tagsJson, []),
    evidence: parseJson<BrainEvidence[]>(row.evidenceJson, []),
  };
}

function canonicalEvidenceFromUnknown(value: unknown): BrainEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): BrainEvidence | null => {
      if (!item || typeof item !== "object") return null;
      const evidence = item as Record<string, unknown>;
      const captureId =
        typeof evidence.captureId === "string" ? evidence.captureId : "";
      const sourceId =
        typeof evidence.sourceId === "string" ? evidence.sourceId : "";
      const quote = typeof evidence.quote === "string" ? evidence.quote : "";
      if (!captureId || !quote) return null;
      const result: BrainEvidence = {
        captureId,
        sourceId,
        captureTitle:
          typeof evidence.captureTitle === "string"
            ? evidence.captureTitle
            : captureId,
        quote,
      };
      if (
        evidence.capturedAtSource === "manual-markdown" &&
        typeof evidence.capturedAt === "string"
      ) {
        result.capturedAt = evidence.capturedAt;
        result.capturedAtSource = "manual-markdown";
      }
      if (typeof evidence.note === "string") result.note = evidence.note;
      const sourceUrl = safeCitationUrl(evidence.sourceUrl ?? evidence.url);
      if (sourceUrl) result.sourceUrl = sourceUrl;
      if (typeof evidence.timestampMs === "number") {
        result.timestampMs = evidence.timestampMs;
      }
      return result;
    })
    .filter((item): item is BrainEvidence => Boolean(item));
}

function stringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : null))
    .filter((item): item is string => Boolean(item));
}

function canonicalValuesFromProposalRow(
  row: typeof schema.brainProposals.$inferSelect,
  draft?: {
    title?: string;
    summary?: string;
    body?: string;
  },
): {
  values: CanonicalResourceValues;
  payload: WriteKnowledgeInput & Record<string, unknown>;
} {
  const payload = parseJson<WriteKnowledgeInput & Record<string, unknown>>(
    row.payloadJson,
    {
      title: row.title,
      body: row.body,
      evidence: [],
    },
  );
  const normalizedEvidence = canonicalEvidenceFromUnknown(payload.evidence);
  const payloadEvidence =
    normalizedEvidence.length > 0
      ? normalizedEvidence
      : parseJson<BrainEvidence[]>(row.evidenceJson, []);
  return {
    payload,
    values: {
      id: payload.knowledgeId ?? row.knowledgeId ?? null,
      title: draft?.title ?? payload.title ?? row.title,
      summary: draft?.summary ?? payload.summary ?? "",
      body: draft?.body ?? payload.body ?? row.body,
      topic: payload.topic ?? null,
      tags: stringArrayFromUnknown(payload.tags),
      evidence: payloadEvidence,
    },
  };
}

export async function previewKnowledgeCanonicalResource(input: {
  knowledgeId?: string;
  proposalId?: string;
  operation?: "publish" | "unpublish";
  draft?: {
    title?: string;
    summary?: string;
    body?: string;
  };
}): Promise<BrainCanonicalResourcePreview> {
  if (input.knowledgeId && input.proposalId) {
    throw new Error("Preview either a knowledge item or a proposal, not both.");
  }
  if (!input.knowledgeId && !input.proposalId) {
    throw new Error("A knowledgeId or proposalId is required.");
  }

  if (input.knowledgeId) {
    const access = await assertAccess(
      "brain-knowledge",
      input.knowledgeId,
      "viewer",
    );
    const row = access.resource;
    await assertDerivedAudienceAccess(row);
    if (row.intelligenceKind && input.operation !== "unpublish") {
      fail(
        "Structured intelligence requires live evidence checks and cannot be mirrored to shared workspace context.",
        { errorCode: "intelligence_canonical_forbidden", statusCode: 403 },
      );
    }
    const values = canonicalValuesFromKnowledgeRow(row);
    const resource = buildCanonicalResource(values);
    const warnings: string[] = [];
    const audienceCanPublish = await canPublishCanonicalAudience(
      row.audienceId,
    );
    if (row.status !== "published") {
      warnings.push(
        "Only published Brain knowledge can become company context.",
      );
    }
    if (!audienceCanPublish) {
      warnings.push(
        "Audience-restricted Brain knowledge cannot become workspace-wide canonical context.",
      );
    }
    if (input.operation === "unpublish" && !row.publishedResourcePath) {
      warnings.push(
        "This knowledge is not currently mirrored to workspace context.",
      );
    }
    return {
      source: "knowledge",
      knowledgeId: row.id,
      title: row.title,
      path: row.publishedResourcePath || resource.path,
      pathExact: true,
      contentType: resource.contentType,
      markdown: resource.markdown,
      canPublish: row.status === "published" && audienceCanPublish,
      alreadyPublishedPath: row.publishedResourcePath,
      revision: knowledgeRevision(row),
      warnings,
    };
  }

  const access = await assertAccess(
    "brain-proposal",
    input.proposalId!,
    "viewer",
  );
  const row = access.resource;
  await assertDerivedAudienceAccess(row);
  const { payload, values } = canonicalValuesFromProposalRow(row, input.draft);
  const resource = buildCanonicalResource(values);
  const status =
    typeof payload.status === "string"
      ? payload.status
      : statusForTier(payload.publishTier ?? "company");
  const warnings: string[] = [];
  const audienceCanPublish = await canPublishCanonicalAudience(row.audienceId);
  if (status !== "published") {
    warnings.push(
      "Approving this proposal would not publish canonical context because its resulting knowledge status is not published.",
    );
  }
  if (!values.id) {
    warnings.push(
      "Approval will assign the final knowledge id, so the Markdown is exact but the path suffix is shown as <new-id>.",
    );
  }
  if (!audienceCanPublish) {
    warnings.push(
      "Audience-restricted Brain knowledge cannot become workspace-wide canonical context.",
    );
  }
  if (row.status !== "pending") {
    warnings.push(`This proposal is already ${row.status}.`);
  }
  return {
    source: "proposal",
    proposalId: row.id,
    knowledgeId: values.id ?? null,
    title: values.title,
    path: resource.path,
    pathExact: resource.pathExact,
    contentType: resource.contentType,
    markdown: resource.markdown,
    canPublish: status === "published" && audienceCanPublish,
    warnings,
  };
}

type PeekedKnowledgeRow = {
  id: string;
  ownerEmail: string;
  captureId: string | null;
  evidenceJson: string;
  provenanceJson: string | null;
  publishedResourcePath: string | null;
  intelligenceKind: string | null;
  updatedAt: string;
};

function mayTouchCanonicalResource(
  peeked: PeekedKnowledgeRow | null,
  wantsPublication: boolean,
) {
  if (peeked?.publishedResourcePath) return true;
  return wantsPublication && !peeked?.intelligenceKind;
}

export function firstRow<T>(rows: readonly T[]): T | undefined {
  return rows[0];
}

async function peekKnowledgeRow(
  knowledgeId: string,
  db: DbHandle = getDb(),
): Promise<PeekedKnowledgeRow | null> {
  const row = firstRow(
    await db
      .select({
        id: schema.brainKnowledge.id,
        ownerEmail: schema.brainKnowledge.ownerEmail,
        captureId: schema.brainKnowledge.captureId,
        evidenceJson: schema.brainKnowledge.evidenceJson,
        provenanceJson: schema.brainKnowledge.provenanceJson,
        publishedResourcePath: schema.brainKnowledge.publishedResourcePath,
        intelligenceKind: schema.brainKnowledge.intelligenceKind,
        updatedAt: schema.brainKnowledge.updatedAt,
      })
      .from(schema.brainKnowledge)
      .where(eq(schema.brainKnowledge.id, knowledgeId))
      .limit(1),
  );
  return row ?? null;
}

function storedCaptureIds(row: {
  captureId: string | null;
  evidenceJson: string;
}) {
  const cited = evidenceCaptureIds(row.evidenceJson);
  const ids = new Set(cited.readable ? cited.captureIds : []);
  if (row.captureId) ids.add(row.captureId);
  return ids;
}

export async function lockKnowledgeWriteSet(input: {
  knowledgeId?: string | undefined;
  supersedesId?: string | undefined;
  evidence: ReadonlyArray<{ captureId: string }>;
}) {
  const before = input.knowledgeId
    ? await peekKnowledgeRow(input.knowledgeId)
    : null;
  const captureIds = new Set(input.evidence.map((item) => item.captureId));
  if (before) for (const id of storedCaptureIds(before)) captureIds.add(id);
  await lockCaptureRows(captureIds);
  await lockKnowledgeRows(
    [input.knowledgeId, input.supersedesId].filter(
      (id): id is string => typeof id === "string",
    ),
  );
  const locked = input.knowledgeId
    ? await peekKnowledgeRow(input.knowledgeId)
    : null;
  return {
    locked,
    evidenceLocked:
      !locked ||
      [...storedCaptureIds(locked)].every((id) => captureIds.has(id)),
  };
}

async function assertKnowledgeEditorAccess(
  knowledgeId: string,
  userEmail: string,
  locked: PeekedKnowledgeRow | null,
) {
  try {
    return await assertAccess("brain-knowledge", knowledgeId, "editor");
  } catch (error) {
    if (
      error instanceof ForbiddenError &&
      locked &&
      locked.ownerEmail.toLowerCase() === userEmail.toLowerCase() &&
      isEvidenceBackedKnowledge(locked)
    )
      fail(
        "This knowledge's evidence is missing, changed or no longer accessible, so it cannot be edited. Create it again with fresh exact evidence quotes.",
        { errorCode: "knowledge_provenance_unavailable", statusCode: 409 },
      );
    throw error;
  }
}

const storedEvidenceInputSchema = z.array(
  z.object({ captureId: z.string().min(1), quote: z.string() }).passthrough(),
);

export interface WriteKnowledgeOptions {
  legacyProposalCreatedAt?: string;
}

function knowledgeConflict(row: KnowledgeRow) {
  return saveConflict(
    "knowledge",
    serializeKnowledge(row),
    knowledgeRevision(row),
  );
}

function supersededConflict(row: KnowledgeRow) {
  countSaveOutcome("superseded_knowledge", "conflict");
  return new ActionContractError(
    `The superseded knowledge ${row.id} changed after you read it, so nothing was saved. Decide again from details.current and resend with supersedesRevision set to details.currentRevision.`,
    {
      errorCode: SAVE_CONFLICT_ERROR_CODE,
      statusCode: 409,
      details: {
        current: serializeKnowledge(row),
        currentRevision: knowledgeRevision(row),
      },
    },
  );
}

function supersessionIsStored(
  superseded: Pick<
    KnowledgeRow,
    "status" | "supersededById" | "publishedResourcePath"
  >,
  id: string,
) {
  return (
    superseded.status === "archived" &&
    superseded.supersededById === id &&
    superseded.publishedResourcePath === null
  );
}

function changedAfterLegacyProposal(row: KnowledgeRow, createdAt: string) {
  const changedAt = Date.parse(row.updatedAt);
  const proposedAt = Date.parse(createdAt);
  if (Number.isNaN(changedAt) || Number.isNaN(proposedAt)) return true;
  return changedAt >= proposedAt;
}

function revisionReadByWriter(
  input: WriteKnowledgeInput,
  existing: KnowledgeRow,
  options: WriteKnowledgeOptions,
) {
  const legacyCreatedAt = options.legacyProposalCreatedAt;
  if (legacyCreatedAt === undefined || input.expectedRevision !== undefined)
    return {
      expectedRevision: input.expectedRevision,
      requireRevision: legacyCreatedAt === undefined,
    };
  return {
    expectedRevision: changedAfterLegacyProposal(existing, legacyCreatedAt)
      ? null
      : knowledgeRevision(existing),
    requireRevision: false,
  };
}

function supersededChangedSinceRead(
  input: WriteKnowledgeInput,
  superseded: KnowledgeRow,
  options: WriteKnowledgeOptions,
) {
  if (input.supersedesRevision !== undefined)
    return input.supersedesRevision !== knowledgeRevision(superseded);
  if (options.legacyProposalCreatedAt !== undefined)
    return changedAfterLegacyProposal(
      superseded,
      options.legacyProposalCreatedAt,
    );
  fail(
    "supersedesRevision is required with supersedesId: send the superseded record's revision from your latest read.",
    { errorCode: "supersedes_revision_required", statusCode: 400 },
  );
}

async function readSupersededKnowledge(
  input: WriteKnowledgeInput,
  id: string,
  options: WriteKnowledgeOptions,
) {
  if (!input.supersedesId) return null;
  const access = await assertAccess(
    "brain-knowledge",
    input.supersedesId,
    "editor",
  );
  const superseded: KnowledgeRow = access.resource;
  if (supersessionIsStored(superseded, id))
    return { row: superseded, stored: true };
  const successor = superseded.supersededById;
  if (superseded.status === "archived" && successor && successor !== id)
    fail(
      `Knowledge ${superseded.id} was already superseded by ${successor}, so nothing was saved. Edit ${successor}, or supersede it instead.`,
      {
        errorCode: "knowledge_already_superseded",
        statusCode: 409,
        details: { supersededById: successor },
      },
    );
  if (supersededChangedSinceRead(input, superseded, options))
    throw supersededConflict(superseded);
  return { row: superseded, stored: false };
}

async function currentKnowledgeConflict(id: string) {
  const row = firstRow(
    await getDb()
      .select()
      .from(schema.brainKnowledge)
      .where(eq(schema.brainKnowledge.id, id))
      .limit(1),
  );
  if (!row)
    fail(`Knowledge ${id} not found`, {
      errorCode: "knowledge_not_found",
      statusCode: 404,
    });
  return knowledgeConflict(row);
}

export async function touchKnowledgeRevision(
  row: KnowledgeRow,
): Promise<KnowledgeRow | null> {
  const touched = await getDb()
    .update(schema.brainKnowledge)
    .set({ updatedAt: nextKnowledgeUpdatedAt(row.updatedAt) })
    .where(knowledgeRowUnchanged(row))
    .returning();
  const changed = changedRowCount(touched);
  if (changed > 1)
    throw new Error(`Touching knowledge ${row.id} changed ${changed} rows.`);
  return firstRow(touched) ?? null;
}

function isExpectedProbeFailure(error: unknown) {
  if (error instanceof EvidenceInputError) return true;
  return isActionContractError(error) && error.statusCode < 500;
}

export async function decideKnowledgeSave<T>(check: {
  record: string;
  expectedRevision: string | null | undefined;
  requireRevision: boolean;
  row: KnowledgeRow;
  current: T;
  evidenceLocked: boolean;
  alreadyStored: () => Promise<boolean>;
}): Promise<"apply" | "already_applied"> {
  const revision = knowledgeRevision(check.row);
  const checked = check.requireRevision || check.expectedRevision !== undefined;
  let stored = false;
  if (
    checked &&
    (check.expectedRevision !== revision || !check.evidenceLocked)
  ) {
    try {
      stored = await check.alreadyStored();
    } catch (error) {
      if (!isExpectedProbeFailure(error)) throw error;
      throw saveConflict(check.record, check.current, revision);
    }
  }
  const decision = checkSaveRevision({
    record: check.record,
    expectedRevision: check.expectedRevision,
    requireRevision: check.requireRevision,
    current: { value: check.current, revision },
    isSameSave: () => stored,
  });
  if (decision === "already_applied" || check.evidenceLocked) return decision;
  if (!stored) throw saveConflict(check.record, check.current, revision);
  countSaveOutcome(check.record, "already_applied");
  return "already_applied";
}

type CanonicalResource = ReturnType<typeof buildCanonicalResource>;

async function canonicalMirrorIsCurrent(
  storedPath: string | null,
  resource: CanonicalResource,
  effects: AfterCommitEffects,
) {
  if (storedPath !== resource.path) return false;
  requireResourceStore(effects);
  const { rows } = await getDbExec().execute({
    sql: "SELECT content FROM resources WHERE owner = ? AND path = ?",
    args: [SHARED_OWNER, resource.path],
  });
  const mirror = firstRow(rows) as { content?: unknown } | undefined;
  return mirror?.content === resource.markdown;
}

async function planKnowledgeWrite(
  input: WriteKnowledgeInput,
  id: string,
  existing: KnowledgeRow | null,
  settings: BrainSettings,
  mode: "write" | "check",
) {
  if (existing?.intelligenceKind && input.publishCanonical) {
    fail(
      "Structured intelligence requires live evidence checks and cannot be mirrored to shared workspace context.",
      { errorCode: "intelligence_canonical_forbidden", statusCode: 403 },
    );
  }
  const tier =
    input.publishTier ?? existing?.publishTier ?? settings.defaultPublishTier;
  let evidenceInput: BrainEvidenceInput[] = input.evidence ?? [];
  const reusesStoredEvidence = Boolean(
    existing?.captureId && !evidenceInput.length,
  );
  if (existing && reusesStoredEvidence) {
    let stored: unknown;
    try {
      stored = JSON.parse(existing.evidenceJson);
    } catch {
      stored = null;
    }
    const parsed = storedEvidenceInputSchema.safeParse(stored);
    if (!parsed.success)
      fail(
        "The saved evidence is unreadable. Supply fresh exact evidence quotes.",
        {
          errorCode: "evidence_resupply_required",
          statusCode: 400,
        },
      );
    evidenceInput = parsed.data as BrainEvidenceInput[];
    if (!evidenceInput.length) {
      throw new Error(
        "Evidence-derived Brain knowledge cannot clear its evidence",
      );
    }
  }
  let validated: Awaited<ReturnType<typeof validateEvidenceWithContent>>;
  try {
    validated = await validateEvidenceWithContent(evidenceInput, {
      reusingStoredEvidence: reusesStoredEvidence,
    });
  } catch (error) {
    if (reusesStoredEvidence && error instanceof EvidenceQuoteMismatchError)
      fail(
        "The saved evidence was redacted or changed and cannot be validated again. Supply fresh exact evidence quotes to edit this knowledge.",
        { errorCode: "evidence_resupply_required", statusCode: 400 },
      );
    throw error;
  }
  const { evidence, content: validatedContent } = validated;
  const sourceId = evidence[0]?.sourceId ?? null;
  const captureId = evidence[0]?.captureId ?? null;
  const lead = firstRow(evidence);
  const evidenceAudience = lead
    ? await ensureEvidenceIntersectionAudience(
        {
          captureIds: evidence.map((item) => item.captureId),
          sourceId: lead.sourceId,
        },
        mode === "write" ? "ensure" : "derive",
      )
    : null;
  if (
    input.publishCanonical &&
    evidenceAudience &&
    evidenceAudience.kind !== "org"
  ) {
    throw new Error(
      "Audience-restricted Brain evidence cannot become workspace-wide canonical context.",
    );
  }
  const redacted = applyRedactions({
    title: input.title,
    body: input.body,
    summary: input.summary,
    topic: input.topic,
    tags: input.tags,
    entities: input.entities,
    evidence,
    redactions: input.redactions,
    autoRedactEmails: settings.autoRedactEmails,
  });
  if (input.supersedesId) {
    await assertAccess("brain-knowledge", input.supersedesId, "editor");
  }
  const visibility = visibilityForTier(tier);
  const status = redacted.redacted ? "redacted" : statusForTier(tier);
  const material = {
    sourceId,
    captureId,
    audienceId: evidenceAudience?.audienceId ?? null,
    kind: input.kind ?? "fact",
    title: redacted.title,
    body: redacted.body,
    summary: redacted.summary,
    topic: redacted.topic,
    tagsJson: stableJson(redacted.tags),
    entitiesJson: stableJson(redacted.entities),
    evidenceJson: stableJson(redacted.evidence),
    confidence: input.confidence ?? 80,
  };
  const provenanceJson = evidence.length
    ? await buildKnowledgeProvenance(material, validatedContent)
    : null;
  const audienceCanPublish =
    !existing?.intelligenceKind &&
    (await canPublishCanonicalAudience(material.audienceId));
  const storedPath = existing?.publishedResourcePath ?? null;
  const canonical:
    | { kind: "none" }
    | { kind: "remove"; path: string }
    | { kind: "publish"; resource: CanonicalResource } =
    storedPath && (status !== "published" || !audienceCanPublish)
      ? { kind: "remove", path: storedPath }
      : status === "published" &&
          audienceCanPublish &&
          (input.publishCanonical || storedPath)
        ? {
            kind: "publish",
            resource: buildCanonicalResource({
              id,
              title: redacted.title,
              summary: redacted.summary,
              body: redacted.body,
              topic: redacted.topic,
              tags: redacted.tags,
              evidence: redacted.evidence,
            }),
          }
        : { kind: "none" };
  return {
    tier,
    status,
    columns: {
      ...material,
      audienceAclHash: evidenceAudience?.aclHash ?? null,
      provenanceJson,
      supersedesId: input.supersedesId ?? null,
      status,
      publishTier: tier,
      visibility,
    },
    canonical,
  };
}

async function plannedKnowledgeIsStored(
  plan: Awaited<ReturnType<typeof planKnowledgeWrite>>,
  row: KnowledgeRow,
  effects: AfterCommitEffects,
) {
  const columns = Object.entries(plan.columns) as Array<
    [keyof KnowledgeRow, unknown]
  >;
  if (columns.some(([key, value]) => (row[key] ?? null) !== (value ?? null)))
    return false;
  if ((plan.status === "published") !== (row.publishedAt !== null))
    return false;
  if (plan.canonical.kind === "remove") return false;
  if (plan.canonical.kind === "none" && row.publishedResourcePath !== null)
    return false;
  if (
    plan.canonical.kind === "publish" &&
    !(await canonicalMirrorIsCurrent(
      row.publishedResourcePath,
      plan.canonical.resource,
      effects,
    ))
  )
    return false;
  const supersedesId = plan.columns.supersedesId;
  if (!supersedesId) return true;
  const superseded = firstRow(
    await getDb()
      .select({
        status: schema.brainKnowledge.status,
        supersededById: schema.brainKnowledge.supersededById,
        publishedResourcePath: schema.brainKnowledge.publishedResourcePath,
      })
      .from(schema.brainKnowledge)
      .where(eq(schema.brainKnowledge.id, supersedesId))
      .limit(1),
  );
  return superseded ? supersessionIsStored(superseded, row.id) : false;
}

export async function knowledgeWriteIsStored(
  input: WriteKnowledgeInput,
  row: KnowledgeRow,
  effects: AfterCommitEffects,
) {
  const plan = await planKnowledgeWrite(
    input,
    row.id,
    row,
    await readBrainSettings(),
    "check",
  );
  return plannedKnowledgeIsStored(plan, row, effects);
}

export async function writeKnowledgeRecordInTransaction(
  input: WriteKnowledgeInput,
  effects: AfterCommitEffects,
  options: WriteKnowledgeOptions = {},
) {
  const userEmail = requireUserEmail();
  if (input.knowledgeId && input.supersedesId === input.knowledgeId)
    fail("Knowledge cannot supersede itself.", {
      errorCode: "knowledge_supersedes_self",
      statusCode: 400,
    });
  const settings = await readBrainSettings();
  const { locked, evidenceLocked } = await lockKnowledgeWriteSet({
    knowledgeId: input.knowledgeId,
    supersedesId: input.supersedesId,
    evidence: input.evidence ?? [],
  });
  const db = getDb();
  const existingAccess = input.knowledgeId
    ? await assertKnowledgeEditorAccess(input.knowledgeId, userEmail, locked)
    : null;
  const existing: KnowledgeRow | null = existingAccess?.resource ?? null;
  const id = input.knowledgeId ?? nanoid();
  if (existing) {
    await assertDerivedAudienceAccess(existing);
    const decision = await decideKnowledgeSave({
      record: "knowledge",
      ...revisionReadByWriter(input, existing, options),
      row: existing,
      current: serializeKnowledge(existing),
      evidenceLocked,
      alreadyStored: async () =>
        plannedKnowledgeIsStored(
          await planKnowledgeWrite(input, id, existing, settings, "check"),
          existing,
          effects,
        ),
    });
    if (decision === "already_applied")
      return {
        mode: "knowledge" as const,
        knowledge: serializeKnowledge(existing),
      };
  }
  const superseded = await readSupersededKnowledge(input, id, options);
  const plan = await planKnowledgeWrite(input, id, existing, settings, "write");
  const now = existing ? nextKnowledgeUpdatedAt(existing.updatedAt) : nowIso();
  const publishedAt =
    plan.status === "published" ? (existing?.publishedAt ?? now) : null;
  if (existing) {
    const written = await db
      .update(schema.brainKnowledge)
      .set({ ...plan.columns, publishedAt, updatedAt: now })
      .where(knowledgeRowUnchanged(existing))
      .returning({ id: schema.brainKnowledge.id });
    const changed = changedRowCount(written);
    if (changed === 0) throw await currentKnowledgeConflict(id);
    if (changed > 1)
      throw new Error(`Save of knowledge ${id} changed ${changed} rows.`);
    countSaveOutcome("knowledge", "written");
  } else {
    await db.insert(schema.brainKnowledge).values({
      id,
      ...plan.columns,
      supersededById: null,
      createdBy: userEmail,
      publishedAt,
      ownerEmail: userEmail,
      orgId: getRequestOrgId() ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }
  const [knowledge] = await db
    .select()
    .from(schema.brainKnowledge)
    .where(eq(schema.brainKnowledge.id, id))
    .limit(1);
  let returned = knowledge;
  if (plan.canonical.kind === "remove") {
    await deleteCanonicalResourceInTransaction(plan.canonical.path, effects);
    await db
      .update(schema.brainKnowledge)
      .set({ publishedResourcePath: null, updatedAt: now })
      .where(eq(schema.brainKnowledge.id, id));
    returned = { ...knowledge, publishedResourcePath: null };
  } else if (plan.canonical.kind === "publish") {
    const publishedResourcePath = await publishKnowledgeResourceInTransaction(
      id,
      plan.canonical.resource,
      effects,
    );
    if (
      existing?.publishedResourcePath &&
      existing.publishedResourcePath !== publishedResourcePath
    ) {
      await deleteCanonicalResourceInTransaction(
        existing.publishedResourcePath,
        effects,
      );
    }
    await db
      .update(schema.brainKnowledge)
      .set({ publishedResourcePath, updatedAt: now })
      .where(eq(schema.brainKnowledge.id, id));
    const [updated] = await db
      .select()
      .from(schema.brainKnowledge)
      .where(eq(schema.brainKnowledge.id, id))
      .limit(1);
    returned = updated;
  }
  if (superseded && !superseded.stored) {
    const old = superseded.row;
    if (old.publishedResourcePath)
      await deleteCanonicalResourceInTransaction(
        old.publishedResourcePath,
        effects,
      );
    const archived = await db
      .update(schema.brainKnowledge)
      .set({
        supersededById: id,
        status: "archived",
        publishedResourcePath: null,
        updatedAt: nextKnowledgeUpdatedAt(old.updatedAt),
      })
      .where(knowledgeRowUnchanged(old))
      .returning({ id: schema.brainKnowledge.id });
    const changed = changedRowCount(archived);
    if (changed !== 1)
      throw new Error(
        `Superseding knowledge ${old.id} changed ${changed} rows.`,
      );
  }
  if (!existing) {
    effects.pending.push(() => {
      try {
        track(
          "knowledge_created",
          {
            app_name: "brain",
            template_name: "brain",
            output_id: id,
            output_type: "knowledge",
            kind: input.kind ?? "fact",
            publish_tier: plan.tier,
          },
          { userId: userEmail },
        );
      } catch {
        console.warn("[brain] Could not emit knowledge creation telemetry");
      }
    });
  }
  return {
    mode: "knowledge" as const,
    knowledge: serializeKnowledge(returned),
  };
}

export async function knowledgeWriteMayTouchCanonical(
  input: Pick<
    WriteKnowledgeInput,
    "knowledgeId" | "supersedesId" | "publishCanonical"
  >,
) {
  const peeked = input.knowledgeId
    ? await peekKnowledgeRow(input.knowledgeId)
    : null;
  const supersededPeek = input.supersedesId
    ? await peekKnowledgeRow(input.supersedesId)
    : null;
  return (
    mayTouchCanonicalResource(peeked, Boolean(input.publishCanonical)) ||
    Boolean(supersededPeek?.publishedResourcePath)
  );
}

export async function writeKnowledgeRecord(
  input: WriteKnowledgeInput,
  options: WriteKnowledgeOptions = {},
) {
  requireUserEmail();
  const { value: result, effects } = await transactWithResourceStore(
    getDb(),
    await knowledgeWriteMayTouchCanonical(input),
    async (_scoped, effects) =>
      writeKnowledgeRecordInTransaction(input, effects, options),
  );
  return {
    ...result,
    ...postCommitWarnings(await runAfterCommitEffects(effects)),
  };
}

export async function searchKnowledgePage(args: {
  query?: string | undefined;
  topic?: string | undefined;
  tag?: string | undefined;
  status?: BrainKnowledgeStatus | "all" | undefined;
  statuses?: BrainKnowledgeStatus[] | undefined;
  includeDrafts?: boolean | undefined;
  limit?: number | undefined;
}) {
  const db = getDb();
  const audienceIds = await listAccessibleAudienceIds();
  const accessibleSourceExists = sql`exists (
    select 1 from ${schema.brainSources}
    where ${schema.brainSources.id} = ${schema.brainKnowledge.sourceId}
      and ${and(accessFilter(schema.brainSources, schema.brainSourceShares), personalGoogleSourceFilter())}
  )`;
  const clauses = [
    accessFilter(schema.brainKnowledge, schema.brainKnowledgeShares),
    or(
      isNull(schema.brainKnowledge.captureId),
      audienceIds.length
        ? and(
            accessibleSourceExists,
            inArray(schema.brainKnowledge.audienceId, audienceIds),
          )
        : undefined,
    )!,
  ];
  if (args.query) {
    const q = `%${args.query}%`;
    clauses.push(
      or(
        ilike(schema.brainKnowledge.title, q),
        ilike(schema.brainKnowledge.body, q),
        ilike(schema.brainKnowledge.summary, q),
        ilike(schema.brainKnowledge.topic, q),
        ilike(schema.brainKnowledge.tagsJson, q),
        ilike(schema.brainKnowledge.entitiesJson, q),
      )!,
    );
  }
  if (args.topic) clauses.push(eq(schema.brainKnowledge.topic, args.topic));
  if (args.tag)
    clauses.push(like(schema.brainKnowledge.tagsJson, `%${args.tag}%`));
  if (args.statuses?.length)
    clauses.push(inArray(schema.brainKnowledge.status, args.statuses));
  if (args.status && args.status !== "all") {
    clauses.push(eq(schema.brainKnowledge.status, args.status));
  } else if (!args.includeDrafts) {
    clauses.push(publishedKnowledgeStatusClause());
  }
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 1000);
  const scanLimit = 1000;
  const pageSize = Math.min(Math.max(limit, 25), 100);
  const currentRows: Array<typeof schema.brainKnowledge.$inferSelect> = [];
  let cursor: { updatedAt: string; id: string } | undefined;
  let scanned = 0;
  const { filterCurrentKnowledgeRows } = await import("./intelligence.js");
  while (scanned < scanLimit) {
    const batchLimit = Math.min(pageSize, scanLimit - scanned);
    const rows = await db
      .select()
      .from(schema.brainKnowledge)
      .where(
        and(
          ...clauses,
          cursor
            ? sql`(${schema.brainKnowledge.updatedAt} < ${cursor.updatedAt}
          or (${schema.brainKnowledge.updatedAt} = ${cursor.updatedAt}
            and ${schema.brainKnowledge.id} < ${cursor.id}))`
            : undefined,
        ),
      )
      .orderBy(
        desc(schema.brainKnowledge.updatedAt),
        desc(schema.brainKnowledge.id),
      )
      .limit(batchLimit);
    scanned += rows.length;
    currentRows.push(...(await filterCurrentKnowledgeRows(rows)));
    if (currentRows.length >= limit) {
      return {
        rows: currentRows.slice(0, limit),
        scanLimited: currentRows.length > limit || rows.length === batchLimit,
      };
    }
    if (rows.length < batchLimit)
      return { rows: currentRows, scanLimited: false };
    const last = rows.find((_row, index) => index === rows.length - 1);
    if (!last) return { rows: currentRows, scanLimited: false };
    cursor = { updatedAt: last.updatedAt, id: last.id };
  }
  return { rows: currentRows, scanLimited: true };
}

export async function searchKnowledgeRows(
  args: Parameters<typeof searchKnowledgePage>[0],
) {
  return (await searchKnowledgePage(args)).rows;
}

export async function readBrainScreen() {
  const navigation = await readAppState("navigation").catch(() => null);
  const nav = navigation as any;
  const { settings, guidance } = await readBrainAgentGuidance();
  const screen: Record<string, unknown> = {
    navigation,
    settings,
    guidance,
  };

  if (nav?.sourceId) {
    const source = await resolveAccess("brain-source", nav.sourceId);
    if (source) {
      screen.source = serializeSource(source.resource);
      const audienceIds = await listAccessibleAudienceIds([source.resource.id]);
      const captures = audienceIds.length
        ? await getDb()
            .select({ capture: schema.brainRawCaptures })
            .from(schema.brainRawCaptures)
            .innerJoin(
              schema.brainCaptureAudiences,
              eq(
                schema.brainCaptureAudiences.captureId,
                schema.brainRawCaptures.id,
              ),
            )
            .where(
              and(
                eq(schema.brainRawCaptures.sourceId, source.resource.id),
                eq(schema.brainRawCaptures.sensitivityDisposition, "allowed"),
                inArray(schema.brainCaptureAudiences.audienceId, audienceIds),
              ),
            )
            .orderBy(desc(schema.brainRawCaptures.capturedAt))
            .limit(10)
        : [];
      const queueByCapture = await latestDistillationQueuesForCaptures(
        captures.map(({ capture }) => capture.id),
      );
      screen.sourceCaptures = captures.map(({ capture }) => ({
        id: capture.id,
        sourceId: capture.sourceId,
        title: capture.title,
        kind: capture.kind,
        status: capture.status,
        capturedAt: capture.capturedAt,
        sourceUrl: sourceUrlFromCaptureMetadata(capture.metadataJson),
        distillationQueue: queueByCapture.get(capture.id) ?? null,
        createdAt: capture.createdAt,
        updatedAt: capture.updatedAt,
      }));
    }
  }
  if (nav?.knowledgeId) {
    const knowledge = await resolveAccess("brain-knowledge", nav.knowledgeId);
    if (knowledge) {
      await assertDerivedAudienceAccess(knowledge.resource);
      screen.knowledge = serializeKnowledge(knowledge.resource);
    }
  }
  const proposalId = nav?.proposalId ?? nav?.reviewItemId;
  if (proposalId) {
    const proposal = await resolveAccess("brain-proposal", proposalId);
    if (proposal) {
      await assertDerivedAudienceAccess(proposal.resource);
      screen.proposal = serializeProposal(proposal.resource);
    }
  }
  if (nav?.view === "review") {
    const params = searchParamsFromPath(nav.path);
    const status = proposalStatusFromNavigation(
      typeof nav.status === "string" ? nav.status : params.get("status"),
    );
    const audienceIds = await listAccessibleAudienceIds();
    const proposals = await getDb()
      .select()
      .from(schema.brainProposals)
      .where(
        and(
          accessFilter(schema.brainProposals, schema.brainProposalShares),
          eq(schema.brainProposals.status, status),
          or(
            isNull(schema.brainProposals.captureId),
            audienceIds.length
              ? and(
                  sql`exists (
                    select 1 from ${schema.brainSources}
                    where ${schema.brainSources.id} = ${schema.brainProposals.sourceId}
                      and ${and(accessFilter(schema.brainSources, schema.brainSourceShares), personalGoogleSourceFilter())}
                  )`,
                  inArray(schema.brainProposals.audienceId, audienceIds),
                )
              : undefined,
          ),
        ),
      )
      .orderBy(desc(schema.brainProposals.updatedAt))
      .limit(10);
    screen.proposals = proposals.map(serializeProposal);
  }
  if (nav?.captureId) {
    const capture = await getAccessibleCapture(nav.captureId);
    if (capture) screen.capture = serializeCapture(capture.capture);
  }
  if (nav?.view === "search" && typeof nav.query === "string" && nav.query) {
    const { searchEverythingRows } = await import("./search.js");
    screen.search = {
      query: nav.query,
      type: nav.type,
      provider: nav.provider,
      status: nav.status,
      results: await searchEverythingRows({
        query: nav.query,
        type: ["knowledge", "capture", "source", "all"].includes(nav.type)
          ? nav.type
          : undefined,
        provider:
          typeof nav.provider === "string" && nav.provider !== "all"
            ? nav.provider
            : undefined,
        status:
          typeof nav.status === "string" && nav.status !== "all"
            ? nav.status
            : undefined,
        limit:
          typeof nav.limit === "number"
            ? Math.min(Math.max(nav.limit, 1), 25)
            : 10,
      }),
    };
  }

  const db = getDb();
  const sources = await db
    .select()
    .from(schema.brainSources)
    .where(
      and(
        accessFilter(schema.brainSources, schema.brainSourceShares),
        personalGoogleSourceFilter(),
      ),
    )
    .orderBy(desc(schema.brainSources.updatedAt))
    .limit(10);
  const { rows: knowledge, scanLimited } = await searchKnowledgePage({
    limit: 10,
  });
  screen.sources = sources.map(serializeSource);
  screen.recentKnowledge = knowledge.map(serializeKnowledge);
  screen.recentKnowledgeScanLimited = scanLimited;
  return screen;
}

function searchParamsFromPath(value: unknown) {
  if (typeof value !== "string") return new URLSearchParams();
  const queryStart = value.indexOf("?");
  if (queryStart === -1) return new URLSearchParams();
  return new URLSearchParams(value.slice(queryStart + 1));
}

function proposalStatusFromNavigation(value: string | null | undefined) {
  if (value === "approved" || value === "rejected") return value;
  return "pending";
}
