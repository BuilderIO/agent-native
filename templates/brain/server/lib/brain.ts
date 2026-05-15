import { and, desc, eq, isNull, like, or } from "drizzle-orm";
import { readAppState } from "@agent-native/core/application-state";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { getSetting, putSetting } from "@agent-native/core/settings";
import { resourcePut, SHARED_OWNER } from "@agent-native/core/resources/store";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
  type ResolvedAccess,
} from "@agent-native/core/sharing";
import { getDb, schema } from "../db/index.js";
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
    evidence: parseJson<BrainEvidence[]>(row.evidenceJson, []),
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
    evidence: parseJson<BrainEvidence[]>(row.evidenceJson, []),
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
  await getAccessibleSource(values.sourceId, "editor");
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
  try {
    await db.insert(schema.brainRawCaptures).values({
      id,
      sourceId: values.sourceId,
      externalId: values.externalId ?? null,
      title: values.title,
      kind: values.kind,
      content: values.content,
      contentHash: await contentHash(values.content),
      metadataJson: stableJson(values.metadata ?? {}),
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
    const sourceUrl =
      item.sourceUrl ?? item.url ?? metadata.sourceUrl?.toString();
    validated.push({
      captureId: item.captureId,
      sourceId: access.capture.sourceId,
      captureTitle: access.capture.title,
      quote,
      note: item.note,
      sourceUrl,
      timestampMs: item.timestampMs,
    });
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
    evidence: values.evidence.map((item) => ({
      ...item,
      quote: redact(item.quote),
      note: item.note ? redact(item.note) : item.note,
    })),
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

async function publishKnowledgeResource(values: {
  id: string;
  title: string;
  summary: string;
  body: string;
  topic?: string | null;
  tags: string[];
  evidence: BrainEvidence[];
}) {
  const path = `context/company-brain/${slugify(values.title)}-${values.id}.md`;
  const citations = values.evidence
    .map((item, index) => {
      const where = item.sourceUrl ? ` (${item.sourceUrl})` : "";
      return `${index + 1}. ${item.captureTitle}${where}: "${item.quote}"`;
    })
    .join("\n");
  const content = [
    `# ${values.title}`,
    values.summary ? `\n${values.summary}` : "",
    `\n${values.body}`,
    values.topic ? `\nTopic: ${values.topic}` : "",
    values.tags.length ? `\nTags: ${values.tags.join(", ")}` : "",
    citations ? `\n## Citations\n${citations}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  await resourcePut(SHARED_OWNER, path, content, "text/markdown", {
    createdBy: "agent",
    visibility: "workspace",
    metadata: {
      app: "brain",
      type: "company-brain-knowledge",
      knowledgeId: values.id,
    },
  });
  return path;
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
  const screen: Record<string, unknown> = { navigation };

  if (nav?.sourceId) {
    const source = await resolveAccess("brain-source", nav.sourceId);
    if (source) screen.source = serializeSource(source.resource);
  }
  if (nav?.knowledgeId) {
    const knowledge = await resolveAccess("brain-knowledge", nav.knowledgeId);
    if (knowledge) screen.knowledge = serializeKnowledge(knowledge.resource);
  }
  if (nav?.captureId) {
    const capture = await getAccessibleCapture(nav.captureId);
    if (capture) screen.capture = serializeCapture(capture.capture);
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
