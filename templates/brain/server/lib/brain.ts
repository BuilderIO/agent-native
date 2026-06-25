import { readAppState } from "@agent-native/core/application-state";
import {
  resourceDeleteByPath,
  resourcePut,
  SHARED_OWNER,
} from "@agent-native/core/resources/store";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { getSetting, putSetting } from "@agent-native/core/settings";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
  type ResolvedAccess,
} from "@agent-native/core/sharing";
import { and, desc, eq, inArray, isNull, like, or } from "drizzle-orm";

import {
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
import { sanitizeCaptureForStorage } from "./capture-sanitization.js";

export const BRAIN_SETTINGS_KEY = "brain-settings";

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
  return trimmed;
}

export function sourceUrlFromMetadataRecord(
  metadata: Record<string, unknown>,
): string | null {
  for (const key of SOURCE_URL_METADATA_KEYS) {
    const value = safeCitationUrl(metadata[key]);
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

export async function readBrainSettings(): Promise<BrainSettings> {
  const stored = await getSetting(BRAIN_SETTINGS_KEY).catch(() => null);
  return {
    ...DEFAULT_BRAIN_SETTINGS,
    ...(stored ?? {}),
  } as BrainSettings;
}

export async function writeBrainSettings(
  patch: Partial<BrainSettings>,
): Promise<BrainSettings> {
  const next = {
    ...(await readBrainSettings()),
    ...patch,
  };
  await putSetting(BRAIN_SETTINGS_KEY, next);
  return next;
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
    requireApprovalForCompanyKnowledge: boolean;
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
          "Answer from reviewed Brain knowledge only.",
          "Use raw captures for distillation and exact quote validation, not as answer support.",
          "If reviewed knowledge is missing or thin, say Brain does not have enough reviewed support.",
        ],
      };
    case "exploratory":
      return {
        rawCaptureFallback: "allowed-leads" as const,
        instructions: [
          "Start with reviewed Brain knowledge, then include accessible raw captures and source records as clearly labeled leads.",
          "Never present raw capture matches as approved company knowledge.",
          "Say when a result is unreviewed and needs distillation or review.",
        ],
      };
    case "balanced":
    default:
      return {
        rawCaptureFallback: "thin-results" as const,
        instructions: [
          "Prefer reviewed Brain knowledge.",
          "Use accessible raw captures only when reviewed knowledge is missing or too thin, and label them as raw capture matches.",
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
      requireApprovalForCompanyKnowledge:
        settings.requireApprovalForCompanyKnowledge,
      autoRedactEmails: settings.autoRedactEmails,
      instructions: distillationInstructions,
      rules: [
        "Extract durable, reusable institutional knowledge only.",
        settings.captureSanitizationEnabled === false
          ? "Captures may contain raw provider text; avoid personal or out-of-scope material."
          : "Transcript captures are pre-sanitized before storage; treat capture text as the durable company-relevant source.",
        "Preserve short exact quotes as evidence.",
        `Use ${settings.defaultPublishTier} as the default publish tier unless the user or capture context clearly calls for another tier.`,
        settings.requireApprovalForCompanyKnowledge
          ? "Expect company-tier writes to route through review unless write-knowledge can safely publish them."
          : "Company-tier writes may publish directly when write-knowledge accepts them.",
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
      citationInstruction: requireCitations
        ? "Cite Brain evidence or source URLs for factual claims; say when support is missing."
        : "Include citations when helpful, but concise uncited summaries are allowed by workspace settings.",
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
  return {
    id: row.id,
    sourceId: row.sourceId,
    externalId: row.externalId,
    title: row.title,
    kind: row.kind as BrainCaptureKind,
    content: row.content,
    contentHash: row.contentHash,
    metadata: parseJson(row.metadataJson, {}),
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

export function serializeKnowledge(
  row: typeof schema.brainKnowledge.$inferSelect,
) {
  return {
    id: row.id,
    sourceId: row.sourceId,
    captureId: row.captureId,
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
  role: "viewer" | "editor" | "admin" | "owner" = "viewer",
): Promise<ResolvedAccess> {
  if (role !== "viewer") {
    return assertAccess("brain-source", sourceId, role);
  }
  const access = await resolveAccess("brain-source", sourceId);
  if (!access) throw new Error(`No access to brain source ${sourceId}`);
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
  return { capture, source: sourceAccess.resource, role: sourceAccess.role };
}

export async function createSource(values: {
  id?: string;
  title: string;
  provider: BrainSourceProvider;
  config?: Record<string, unknown>;
  visibility?: "private" | "org" | "public";
}) {
  const db = getDb();
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
    visibility: values.visibility ?? "org",
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

export async function ensureManualSource(title = "Manual imports") {
  const db = getDb();
  const userEmail = requireUserEmail();
  const orgId = getRequestOrgId();
  const where = and(
    eq(schema.brainSources.ownerEmail, userEmail),
    eq(schema.brainSources.provider, "manual"),
    eq(schema.brainSources.title, title),
    orgId
      ? eq(schema.brainSources.orgId, orgId)
      : isNull(schema.brainSources.orgId),
  );
  const [existing] = await db
    .select()
    .from(schema.brainSources)
    .where(where)
    .limit(1);
  if (existing) return existing;
  return createSource({ title, provider: "manual" });
}

function isUniqueConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint|duplicate key|unique/i.test(message);
}

export async function createCapture(values: {
  id?: string;
  sourceId: string;
  externalId?: string | null;
  title: string;
  kind: BrainCaptureKind;
  content: string;
  metadata?: Record<string, unknown>;
  capturedAt?: string;
  status?: "queued" | "distilling" | "distilled" | "ignored";
}) {
  const sourceAccess = await getAccessibleSource(values.sourceId, "editor");
  const source =
    sourceAccess.resource as typeof schema.brainSources.$inferSelect;
  const db = getDb();
  const now = nowIso();
  const id = values.id ?? nanoid();
  if (values.externalId) {
    const [existing] = await db
      .select()
      .from(schema.brainRawCaptures)
      .where(
        and(
          eq(schema.brainRawCaptures.sourceId, values.sourceId),
          eq(schema.brainRawCaptures.externalId, values.externalId),
        ),
      )
      .limit(1);
    if (existing) return existing;
  }
  const settings = await readBrainSettings();
  const metadata = sanitizeGranolaCaptureMetadataLinks(
    source.provider as BrainSourceProvider,
    values.metadata,
  );
  const sanitized = await sanitizeCaptureForStorage({
    kind: values.kind,
    title: values.title,
    content: values.content,
    metadata,
    capturedAt: values.capturedAt,
    source: {
      id: source.id,
      title: source.title,
      provider: source.provider as BrainSourceProvider,
      ownerEmail: source.ownerEmail,
    },
    sourceConfig: parseJson<Record<string, unknown>>(source.configJson, {}),
    settings,
  });
  try {
    await db.insert(schema.brainRawCaptures).values({
      id,
      sourceId: values.sourceId,
      externalId: values.externalId ?? null,
      title: sanitized.title,
      kind: values.kind,
      content: sanitized.content,
      contentHash: await contentHash(sanitized.content),
      metadataJson: stableJson(sanitized.metadata),
      capturedAt: values.capturedAt ?? now,
      importedBy: requireUserEmail(),
      status: values.status ?? "queued",
      distilledAt: values.status === "distilled" ? now : null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    if (values.externalId && isUniqueConflict(err)) {
      const [existing] = await db
        .select()
        .from(schema.brainRawCaptures)
        .where(
          and(
            eq(schema.brainRawCaptures.sourceId, values.sourceId),
            eq(schema.brainRawCaptures.externalId, values.externalId),
          ),
        )
        .limit(1);
      if (existing) return existing;
    }
    throw err;
  }
  const [capture] = await db
    .select()
    .from(schema.brainRawCaptures)
    .where(eq(schema.brainRawCaptures.id, id))
    .limit(1);
  return capture;
}

export async function validateEvidence(
  evidence: BrainEvidenceInput[],
): Promise<BrainEvidence[]> {
  const validated: BrainEvidence[] = [];
  for (const item of evidence) {
    const access = await getAccessibleCapture(item.captureId);
    if (!access) throw new Error(`No access to capture ${item.captureId}`);
    const quote = item.quote.trim();
    if (!quote) throw new Error("Evidence quote cannot be empty");
    if (!access.capture.content.includes(quote)) {
      throw new Error(
        `Evidence quote is not an exact substring of capture ${item.captureId}`,
      );
    }
    const metadata = parseJson<Record<string, unknown>>(
      access.capture.metadataJson,
      {},
    );
    const sourceUrl = safeCitationUrl(
      item.sourceUrl ?? item.url ?? metadata.sourceUrl,
    );
    const result: BrainEvidence = {
      captureId: item.captureId,
      sourceId: access.capture.sourceId,
      captureTitle: access.capture.title,
      quote,
      note: item.note,
      timestampMs: item.timestampMs,
    };
    if (sourceUrl) result.sourceUrl = sourceUrl;
    validated.push(result);
  }
  return validated;
}

export function visibilityForTier(
  tier: BrainPublishTier,
): "private" | "org" | "public" {
  if (tier === "private") return "private";
  return "org";
}

export function statusForTier(tier: BrainPublishTier): BrainKnowledgeStatus {
  return tier === "private" ? "draft" : "published";
}

export function applyRedactions(values: {
  title: string;
  body: string;
  summary?: string;
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
    tags: (values.tags ?? []).map((tag) => redact(tag)),
    entities: (values.entities ?? []).map((entity) => ({
      type: redact(entity.type),
      name: redact(entity.name),
    })),
    evidence: sanitizeEvidenceCitationUrls(
      values.evidence.map((item) => ({
        ...item,
        quote: redact(item.quote),
        note: item.note ? redact(item.note) : item.note,
      })),
    ),
    redacted: changed,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface WriteKnowledgeInput {
  knowledgeId?: string;
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
  proposalMode?: "auto" | "always" | "never";
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

async function publishKnowledgeResource(values: {
  id: string;
  title: string;
  summary: string;
  body: string;
  topic?: string | null;
  tags: string[];
  evidence: BrainEvidence[];
}) {
  const resource = buildCanonicalResource(values);
  await resourcePut(
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
        knowledgeId: values.id,
      },
    },
  );
  return resource.path;
}

export async function setKnowledgeCanonicalResource(
  knowledgeId: string,
  published: boolean,
) {
  const access = await assertAccess("brain-knowledge", knowledgeId, "editor");
  const row = access.resource;
  const db = getDb();

  if (!published) {
    if (row.publishedResourcePath) {
      await resourceDeleteByPath(SHARED_OWNER, row.publishedResourcePath);
    }
    await db
      .update(schema.brainKnowledge)
      .set({ publishedResourcePath: null, updatedAt: nowIso() })
      .where(eq(schema.brainKnowledge.id, knowledgeId));
  } else {
    if (row.status !== "published") {
      throw new Error(
        "Only published Brain knowledge can become company context.",
      );
    }
    const publishedResourcePath = await publishKnowledgeResource({
      id: row.id,
      title: row.title,
      summary: row.summary,
      body: row.body,
      topic: row.topic,
      tags: parseJson<string[]>(row.tagsJson, []),
      evidence: parseJson<BrainEvidence[]>(row.evidenceJson, []),
    });
    await db
      .update(schema.brainKnowledge)
      .set({ publishedResourcePath, updatedAt: nowIso() })
      .where(eq(schema.brainKnowledge.id, knowledgeId));
  }

  const [updated] = await db
    .select()
    .from(schema.brainKnowledge)
    .where(eq(schema.brainKnowledge.id, knowledgeId))
    .limit(1);
  return serializeKnowledge(updated);
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
    const values = canonicalValuesFromKnowledgeRow(row);
    const resource = buildCanonicalResource(values);
    const warnings: string[] = [];
    if (row.status !== "published") {
      warnings.push(
        "Only published Brain knowledge can become company context.",
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
      canPublish: row.status === "published",
      alreadyPublishedPath: row.publishedResourcePath,
      warnings,
    };
  }

  const access = await assertAccess(
    "brain-proposal",
    input.proposalId!,
    "viewer",
  );
  const row = access.resource;
  const { payload, values } = canonicalValuesFromProposalRow(row, input.draft);
  const resource = buildCanonicalResource(values);
  const status =
    typeof payload.status === "string"
      ? payload.status
      : statusForTier(payload.publishTier ?? "company");
  const warnings: string[] = [];
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
    canPublish: status === "published",
    warnings,
  };
}

export async function writeKnowledgeRecord(
  input: WriteKnowledgeInput,
  options: { bypassProposal?: boolean } = {},
) {
  const db = getDb();
  const userEmail = requireUserEmail();
  const settings = await readBrainSettings();
  const tier = input.publishTier ?? settings.defaultPublishTier;
  const evidence = await validateEvidence(input.evidence ?? []);
  const sourceId = evidence[0]?.sourceId ?? null;
  const captureId = evidence[0]?.captureId ?? null;
  const redacted = applyRedactions({
    title: input.title,
    body: input.body,
    summary: input.summary,
    tags: input.tags,
    entities: input.entities,
    evidence,
    redactions: input.redactions,
    autoRedactEmails: settings.autoRedactEmails,
  });
  const now = nowIso();
  const existingAccess = input.knowledgeId
    ? await assertAccess("brain-knowledge", input.knowledgeId, "editor")
    : null;
  if (input.supersedesId) {
    await assertAccess("brain-knowledge", input.supersedesId, "editor");
  }
  const existing = existingAccess?.resource ?? null;
  const ownerEmail = existing?.ownerEmail ?? userEmail;
  const orgId = existing?.orgId ?? getRequestOrgId() ?? null;
  const visibility = visibilityForTier(tier);
  const status = redacted.redacted ? "redacted" : statusForTier(tier);
  const highConfidenceAutoPublish =
    (input.confidence ?? 80) >= 90 && !input.knowledgeId && !redacted.redacted;
  const needsProposal =
    !options.bypassProposal &&
    (input.proposalMode === "always" ||
      (input.proposalMode !== "never" &&
        tier === "company" &&
        settings.requireApprovalForCompanyKnowledge &&
        !highConfidenceAutoPublish));

  const payload = {
    knowledgeId: input.knowledgeId,
    title: redacted.title,
    body: redacted.body,
    summary: redacted.summary,
    topic: input.topic ?? null,
    tags: redacted.tags,
    entities: redacted.entities,
    evidence: redacted.evidence,
    confidence: input.confidence ?? 80,
    publishTier: tier,
    kind: input.kind ?? "fact",
    supersedesId: input.supersedesId,
    sourceId,
    captureId,
    status,
    visibility,
    publishCanonical: input.publishCanonical ?? false,
  };

  if (needsProposal) {
    const proposalId = nanoid();
    await db.insert(schema.brainProposals).values({
      id: proposalId,
      knowledgeId: input.knowledgeId ?? null,
      sourceId,
      captureId,
      title: redacted.title,
      body: redacted.body,
      rationale: input.rationale ?? "",
      proposedAction: input.knowledgeId ? "update" : "create",
      payloadJson: stableJson(payload),
      evidenceJson: stableJson(redacted.evidence),
      status: "pending",
      reviewerNotes: null,
      createdBy: userEmail,
      reviewedBy: null,
      reviewedAt: null,
      ownerEmail,
      orgId,
      visibility,
      createdAt: now,
      updatedAt: now,
    });
    const [proposal] = await db
      .select()
      .from(schema.brainProposals)
      .where(eq(schema.brainProposals.id, proposalId))
      .limit(1);
    return { mode: "proposal" as const, proposal: serializeProposal(proposal) };
  }

  const id = input.knowledgeId ?? nanoid();
  if (existing) {
    await db
      .update(schema.brainKnowledge)
      .set({
        sourceId,
        captureId,
        kind: input.kind ?? "fact",
        title: redacted.title,
        body: redacted.body,
        summary: redacted.summary,
        topic: input.topic ?? null,
        tagsJson: stableJson(redacted.tags),
        entitiesJson: stableJson(redacted.entities),
        evidenceJson: stableJson(redacted.evidence),
        supersedesId: input.supersedesId ?? null,
        confidence: input.confidence ?? 80,
        status,
        publishTier: tier,
        visibility,
        publishedAt:
          status === "published" ? (existing.publishedAt ?? now) : null,
        updatedAt: now,
      })
      .where(eq(schema.brainKnowledge.id, id));
  } else {
    await db.insert(schema.brainKnowledge).values({
      id,
      sourceId,
      captureId,
      kind: input.kind ?? "fact",
      title: redacted.title,
      body: redacted.body,
      summary: redacted.summary,
      topic: input.topic ?? null,
      tagsJson: stableJson(redacted.tags),
      entitiesJson: stableJson(redacted.entities),
      evidenceJson: stableJson(redacted.evidence),
      supersedesId: input.supersedesId ?? null,
      supersededById: null,
      confidence: input.confidence ?? 80,
      status,
      publishTier: tier,
      createdBy: userEmail,
      publishedAt: status === "published" ? now : null,
      ownerEmail,
      orgId,
      visibility,
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
  if (input.publishCanonical && status === "published") {
    const publishedResourcePath = await publishKnowledgeResource({
      id,
      title: redacted.title,
      summary: redacted.summary,
      body: redacted.body,
      topic: input.topic,
      tags: redacted.tags,
      evidence: redacted.evidence,
    });
    await db
      .update(schema.brainKnowledge)
      .set({ publishedResourcePath, updatedAt: nowIso() })
      .where(eq(schema.brainKnowledge.id, id));
    const [updated] = await db
      .select()
      .from(schema.brainKnowledge)
      .where(eq(schema.brainKnowledge.id, id))
      .limit(1);
    returned = updated;
  }
  if (input.supersedesId) {
    await db
      .update(schema.brainKnowledge)
      .set({ supersededById: id, status: "archived", updatedAt: nowIso() })
      .where(eq(schema.brainKnowledge.id, input.supersedesId));
  }
  return {
    mode: "knowledge" as const,
    knowledge: serializeKnowledge(returned),
  };
}

export async function searchKnowledgeRows(args: {
  query?: string;
  topic?: string;
  tag?: string;
  status?: BrainKnowledgeStatus | "all";
  includeDrafts?: boolean;
  limit?: number;
}) {
  const db = getDb();
  const clauses = [
    accessFilter(schema.brainKnowledge, schema.brainKnowledgeShares),
  ];
  if (args.query) {
    const q = `%${args.query}%`;
    clauses.push(
      or(
        like(schema.brainKnowledge.title, q),
        like(schema.brainKnowledge.body, q),
        like(schema.brainKnowledge.summary, q),
      )!,
    );
  }
  if (args.topic) clauses.push(eq(schema.brainKnowledge.topic, args.topic));
  if (args.tag)
    clauses.push(like(schema.brainKnowledge.tagsJson, `%${args.tag}%`));
  if (args.status && args.status !== "all") {
    clauses.push(eq(schema.brainKnowledge.status, args.status));
  } else if (!args.includeDrafts) {
    clauses.push(
      or(
        eq(schema.brainKnowledge.status, "published"),
        eq(schema.brainKnowledge.status, "redacted"),
      )!,
    );
  }
  return db
    .select()
    .from(schema.brainKnowledge)
    .where(and(...clauses))
    .orderBy(desc(schema.brainKnowledge.updatedAt))
    .limit(args.limit ?? 25);
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
      const captures = await getDb()
        .select()
        .from(schema.brainRawCaptures)
        .where(eq(schema.brainRawCaptures.sourceId, source.resource.id))
        .orderBy(desc(schema.brainRawCaptures.capturedAt))
        .limit(10);
      const queueByCapture = await latestDistillationQueuesForCaptures(
        captures.map((capture) => capture.id),
      );
      screen.sourceCaptures = captures.map((capture) => ({
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
    if (knowledge) screen.knowledge = serializeKnowledge(knowledge.resource);
  }
  const proposalId = nav?.proposalId ?? nav?.reviewItemId;
  if (proposalId) {
    const proposal = await resolveAccess("brain-proposal", proposalId);
    if (proposal) screen.proposal = serializeProposal(proposal.resource);
  }
  if (nav?.view === "review") {
    const params = searchParamsFromPath(nav.path);
    const status = proposalStatusFromNavigation(
      typeof nav.status === "string" ? nav.status : params.get("status"),
    );
    const proposals = await getDb()
      .select()
      .from(schema.brainProposals)
      .where(
        and(
          accessFilter(schema.brainProposals, schema.brainProposalShares),
          eq(schema.brainProposals.status, status),
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
    .where(accessFilter(schema.brainSources, schema.brainSourceShares))
    .orderBy(desc(schema.brainSources.updatedAt))
    .limit(10);
  const knowledge = await searchKnowledgeRows({ limit: 10 });
  screen.sources = sources.map(serializeSource);
  screen.recentKnowledge = knowledge.map(serializeKnowledge);
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
