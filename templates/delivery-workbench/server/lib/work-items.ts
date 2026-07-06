import {
  accessFilter,
  assertAccess,
  currentAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";

export const workItemStatusSchema = z.enum([
  "open",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
]);

export const workItemPrioritySchema = z.enum([
  "low",
  "normal",
  "high",
  "urgent",
]);

export const normalizedWorkItemSchema = z.object({
  sourceId: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  title: z.string().min(1),
  body: z.string().optional(),
  status: workItemStatusSchema.optional().default("open"),
  priority: workItemPrioritySchema.optional().default("normal"),
  assigneeEmail: z.string().email().optional(),
  teamId: z.string().optional(),
  tags: z.array(z.string().min(1)).optional().default([]),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  sourceUpdatedAt: z.string().optional(),
  dueAt: z.string().optional(),
  rawRef: z.string().optional(),
});

export const ingestWorkItemsInputSchema = z.object({
  provider: z.string().min(1),
  cursorStart: z.string().optional(),
  cursorEnd: z.string().optional(),
  items: z.array(normalizedWorkItemSchema).max(1000),
});

export const listWorkItemsInputSchema = z.object({
  status: workItemStatusSchema.optional(),
  priority: workItemPrioritySchema.optional(),
  provider: z.string().optional(),
  assigneeEmail: z.string().email().optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const updateWorkItemInputSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  body: z.string().nullable().optional(),
  status: workItemStatusSchema.optional(),
  priority: workItemPrioritySchema.optional(),
  assigneeEmail: z.string().email().nullable().optional(),
  teamId: z.string().nullable().optional(),
  tags: z.array(z.string().min(1)).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  dueAt: z.string().nullable().optional(),
});

export const routingRuleInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional().default(true),
  priority: z.coerce.number().int().min(0).max(10000).default(100),
  match: z
    .object({
      provider: z.string().optional(),
      status: workItemStatusSchema.optional(),
      priority: workItemPrioritySchema.optional(),
      tagsAny: z.array(z.string().min(1)).optional(),
    })
    .optional()
    .default({}),
  assignToEmail: z.string().email().optional(),
  assignToTeamId: z.string().optional(),
});

type NormalizedWorkItem = z.infer<typeof normalizedWorkItemSchema>;
type RoutingRuleMatch = z.infer<typeof routingRuleInputSchema>["match"];
type DbClient = Pick<ReturnType<typeof getDb>, "insert" | "select" | "update">;

export type IngestWorkItemsResult = {
  ingestRunId: string;
  provider: string;
  itemCount: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  workItemIds: string[];
  snapshotCount: number;
  routingSuggestionCount: number;
};

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random.replace(/-/g, "")}`;
}

export function ownerScopeKey(userEmail: string, orgId?: string | null) {
  const email = userEmail.trim().toLowerCase();
  if (!email) throw new Error("Owner scope requires an authenticated user.");
  const org = orgId?.trim();
  return org ? `user:${email}:org:${org}` : `user:${email}:solo`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as any)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: unknown): string {
  const input = stableJson(value);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeTags(tags: string[]) {
  return Array.from(
    new Set(tags.map((tag) => tag.trim()).filter(Boolean)),
  ).sort();
}

function serializeItem(provider: string, item: NormalizedWorkItem) {
  const tags = normalizeTags(item.tags);
  return {
    provider,
    sourceId: item.sourceId,
    sourceUrl: item.sourceUrl ?? null,
    title: item.title,
    body: item.body ?? null,
    status: item.status,
    priority: item.priority,
    assigneeEmail: item.assigneeEmail ?? null,
    teamId: item.teamId ?? null,
    tags,
    metadata: item.metadata,
    sourceUpdatedAt: item.sourceUpdatedAt ?? null,
    dueAt: item.dueAt ?? null,
  };
}

function mapWorkItem(row: typeof schema.workItems.$inferSelect) {
  return {
    id: row.id,
    provider: row.provider,
    sourceId: row.sourceId,
    sourceUrl: row.sourceUrl,
    title: row.title,
    body: row.body,
    status: row.status,
    priority: row.priority,
    assigneeEmail: row.assigneeEmail,
    teamId: row.teamId,
    tags: parseJson<string[]>(row.tagsJson, []),
    metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
    sourceUpdatedAt: row.sourceUpdatedAt,
    dueAt: row.dueAt,
    lastSnapshotHash: row.lastSnapshotHash,
    lastIngestRunId: row.lastIngestRunId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId,
    visibility: row.visibility,
  };
}

function ruleMatches(
  provider: string,
  item: NormalizedWorkItem,
  match: RoutingRuleMatch,
) {
  if (match.provider && match.provider !== provider) return false;
  if (match.status && match.status !== item.status) return false;
  if (match.priority && match.priority !== item.priority) return false;
  if (match.tagsAny?.length) {
    const tags = new Set(normalizeTags(item.tags));
    if (!match.tagsAny.some((tag) => tags.has(tag))) return false;
  }
  return true;
}

async function listEnabledRoutingRules(db: DbClient = getDb()) {
  const rows = await db
    .select()
    .from(schema.routingRules)
    .where(
      and(
        accessFilter(schema.routingRules, schema.routingRuleShares),
        eq(schema.routingRules.enabled, true),
      ),
    )
    .orderBy(schema.routingRules.priority, desc(schema.routingRules.updatedAt));
  return rows.map((rule) => ({
    ...rule,
    match: parseJson<RoutingRuleMatch>(rule.matchJson, {}),
  }));
}

export async function ingestWorkItems(
  input: z.infer<typeof ingestWorkItemsInputSchema>,
) {
  const parsed = ingestWorkItemsInputSchema.parse(input);
  const db = getDb();
  const { userEmail, orgId } = currentAccess();
  if (!userEmail) {
    throw new Error("ingest-work-items requires an authenticated user.");
  }

  const startedAt = nowIso();
  const runId = createId("ingest");
  try {
    return await db.transaction((tx) =>
      ingestWorkItemsInTransaction(parsed, {
        db: tx as DbClient,
        userEmail,
        orgId,
        runId,
        startedAt,
      }),
    );
  } catch (error) {
    await db
      .insert(schema.ingestRuns)
      .values({
        id: runId,
        provider: parsed.provider,
        cursorStart: parsed.cursorStart ?? null,
        cursorEnd: parsed.cursorEnd ?? null,
        status: "failed",
        itemCount: parsed.items.length,
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt: nowIso(),
        ownerEmail: userEmail,
        orgId: orgId ?? null,
      })
      .catch(() => undefined);
    throw error;
  }
}

export async function ingestWorkItemsInTransaction(
  parsed: z.infer<typeof ingestWorkItemsInputSchema>,
  options: {
    db: DbClient;
    userEmail: string;
    orgId?: string | null;
    runId?: string;
    startedAt?: string;
  },
): Promise<IngestWorkItemsResult> {
  const db = options.db;
  const userEmail = options.userEmail;
  const orgId = options.orgId ?? null;
  const startedAt = options.startedAt ?? nowIso();
  const runId = options.runId ?? createId("ingest");
  const scopeKey = ownerScopeKey(userEmail, orgId);
  const sourceIds = parsed.items.map((item) => item.sourceId);
  const existingRows =
    sourceIds.length > 0
      ? await db
          .select()
          .from(schema.workItems)
          .where(
            and(
              eq(schema.workItems.scopeKey, scopeKey),
              eq(schema.workItems.ownerEmail, userEmail),
              orgId
                ? eq(schema.workItems.orgId, orgId)
                : sql`${schema.workItems.orgId} IS NULL`,
              eq(schema.workItems.provider, parsed.provider),
              inArray(schema.workItems.sourceId, sourceIds),
            ),
          )
      : [];
  const existingBySourceId = new Map(
    existingRows.map((row) => [row.sourceId, row]),
  );
  const rules = await listEnabledRoutingRules(db);

  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  const workItemIds: string[] = [];
  const snapshotRows: Array<typeof schema.sourceSnapshots.$inferInsert> = [];
  const suggestionRows: Array<typeof schema.routingSuggestions.$inferInsert> =
    [];

  await db.insert(schema.ingestRuns).values({
    id: runId,
    provider: parsed.provider,
    cursorStart: parsed.cursorStart ?? null,
    cursorEnd: parsed.cursorEnd ?? null,
    status: "started",
    itemCount: parsed.items.length,
    startedAt,
    ownerEmail: userEmail,
    orgId,
  });

  for (const item of parsed.items) {
    const normalized = serializeItem(parsed.provider, item);
    const snapshotHash = stableHash(normalized);
    const existing = existingBySourceId.get(item.sourceId);
    const changed = existing?.lastSnapshotHash !== snapshotHash;
    const workItemId = existing?.id ?? createId("work");
    const timestamp = item.sourceUpdatedAt ?? startedAt;

    if (!existing) {
      createdCount += 1;
      await db.insert(schema.workItems).values({
        id: workItemId,
        scopeKey,
        provider: parsed.provider,
        sourceId: item.sourceId,
        sourceUrl: item.sourceUrl ?? null,
        title: item.title,
        body: item.body ?? null,
        status: item.status,
        priority: item.priority,
        assigneeEmail: item.assigneeEmail ?? null,
        teamId: item.teamId ?? null,
        tagsJson: JSON.stringify(normalized.tags),
        metadataJson: stableJson(item.metadata),
        sourceUpdatedAt: item.sourceUpdatedAt ?? null,
        dueAt: item.dueAt ?? null,
        lastSnapshotHash: snapshotHash,
        lastIngestRunId: runId,
        createdAt: timestamp,
        updatedAt: timestamp,
        ownerEmail: userEmail,
        orgId,
        visibility: "private",
      });
    } else if (changed) {
      updatedCount += 1;
      await db
        .update(schema.workItems)
        .set({
          sourceUrl: item.sourceUrl ?? null,
          title: item.title,
          body: item.body ?? null,
          status: item.status,
          priority: item.priority,
          assigneeEmail: item.assigneeEmail ?? existing.assigneeEmail,
          teamId: item.teamId ?? existing.teamId,
          tagsJson: JSON.stringify(normalized.tags),
          metadataJson: stableJson(item.metadata),
          sourceUpdatedAt: item.sourceUpdatedAt ?? existing.sourceUpdatedAt,
          dueAt: item.dueAt ?? existing.dueAt,
          lastSnapshotHash: snapshotHash,
          lastIngestRunId: runId,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(schema.workItems.id, existing.id),
            eq(schema.workItems.scopeKey, scopeKey),
            eq(schema.workItems.ownerEmail, userEmail),
            orgId
              ? eq(schema.workItems.orgId, orgId)
              : sql`${schema.workItems.orgId} IS NULL`,
          ),
        );
    } else {
      unchangedCount += 1;
    }

    workItemIds.push(workItemId);
    snapshotRows.push({
      id: createId("snap"),
      workItemId,
      ingestRunId: runId,
      provider: parsed.provider,
      sourceId: item.sourceId,
      snapshotHash,
      normalizedJson: stableJson(normalized),
      rawRef: item.rawRef ?? null,
      capturedAt: startedAt,
      changed,
      ownerEmail: userEmail,
      orgId,
    });

    if (!item.assigneeEmail) {
      const rule = rules.find((candidate) =>
        ruleMatches(parsed.provider, item, candidate.match),
      );
      if (rule?.assignToEmail || rule?.assignToTeamId) {
        suggestionRows.push({
          id: createId("route"),
          workItemId,
          ruleId: rule.id,
          suggestedAssigneeEmail: rule.assignToEmail,
          suggestedTeamId: rule.assignToTeamId,
          reason: `Matched routing rule: ${rule.name}`,
          confidence: 100,
          createdAt: startedAt,
          ownerEmail: userEmail,
          orgId,
        });
      }
    }
  }

  if (snapshotRows.length > 0) {
    await db.insert(schema.sourceSnapshots).values(snapshotRows);
  }
  if (suggestionRows.length > 0) {
    await db.insert(schema.routingSuggestions).values(suggestionRows);
  }
  await db
    .update(schema.ingestRuns)
    .set({
      status: "succeeded",
      createdCount,
      updatedCount,
      unchangedCount,
      finishedAt: nowIso(),
    })
    .where(eq(schema.ingestRuns.id, runId));

  return {
    ingestRunId: runId,
    provider: parsed.provider,
    itemCount: parsed.items.length,
    createdCount,
    updatedCount,
    unchangedCount,
    workItemIds,
    snapshotCount: snapshotRows.length,
    routingSuggestionCount: suggestionRows.length,
  };
}

export async function listWorkItems(
  input: z.input<typeof listWorkItemsInputSchema>,
) {
  const args = listWorkItemsInputSchema.parse(input);
  const clauses = [
    accessFilter(schema.workItems, schema.workItemShares),
    args.status ? eq(schema.workItems.status, args.status) : undefined,
    args.priority ? eq(schema.workItems.priority, args.priority) : undefined,
    args.provider ? eq(schema.workItems.provider, args.provider) : undefined,
    args.assigneeEmail
      ? eq(schema.workItems.assigneeEmail, args.assigneeEmail)
      : undefined,
    args.tag
      ? sql`${schema.workItems.tagsJson} like ${`%"${args.tag.replace(/"/g, '\\"')}"%`}`
      : undefined,
    args.search
      ? or(
          sql`lower(${schema.workItems.title}) like ${`%${args.search.toLowerCase()}%`}`,
          sql`lower(${schema.workItems.body}) like ${`%${args.search.toLowerCase()}%`}`,
        )
      : undefined,
  ].filter(Boolean);

  const rows = await getDb()
    .select({
      id: schema.workItems.id,
      provider: schema.workItems.provider,
      sourceId: schema.workItems.sourceId,
      sourceUrl: schema.workItems.sourceUrl,
      title: schema.workItems.title,
      status: schema.workItems.status,
      priority: schema.workItems.priority,
      assigneeEmail: schema.workItems.assigneeEmail,
      teamId: schema.workItems.teamId,
      tagsJson: schema.workItems.tagsJson,
      sourceUpdatedAt: schema.workItems.sourceUpdatedAt,
      dueAt: schema.workItems.dueAt,
      updatedAt: schema.workItems.updatedAt,
      ownerEmail: schema.workItems.ownerEmail,
      orgId: schema.workItems.orgId,
      visibility: schema.workItems.visibility,
    })
    .from(schema.workItems)
    .where(and(...clauses))
    .orderBy(desc(schema.workItems.updatedAt))
    .limit(args.limit);

  return rows.map((row) => ({
    ...row,
    tags: parseJson<string[]>(row.tagsJson, []),
    tagsJson: undefined,
  }));
}

export async function getWorkItem(id: string) {
  const access = await resolveAccess("delivery_work_item", id);
  if (!access) return null;
  const db = getDb();
  const item = mapWorkItem(
    access.resource as typeof schema.workItems.$inferSelect,
  );
  const [snapshots, suggestions] = await Promise.all([
    db
      .select()
      .from(schema.sourceSnapshots)
      .where(eq(schema.sourceSnapshots.workItemId, id))
      .orderBy(desc(schema.sourceSnapshots.capturedAt))
      .limit(10),
    db
      .select()
      .from(schema.routingSuggestions)
      .where(eq(schema.routingSuggestions.workItemId, id))
      .orderBy(desc(schema.routingSuggestions.createdAt))
      .limit(10),
  ]);
  return {
    ...item,
    role: access.role,
    recentSnapshots: snapshots.map((snapshot) => ({
      id: snapshot.id,
      ingestRunId: snapshot.ingestRunId,
      snapshotHash: snapshot.snapshotHash,
      rawRef: snapshot.rawRef,
      capturedAt: snapshot.capturedAt,
      changed: snapshot.changed,
    })),
    routingSuggestions: suggestions,
  };
}

export async function updateWorkItem(
  input: z.input<typeof updateWorkItemInputSchema>,
) {
  const args = updateWorkItemInputSchema.parse(input);
  const access = await assertAccess("delivery_work_item", args.id, "editor");
  const existing = access.resource as typeof schema.workItems.$inferSelect;
  const set: Partial<typeof schema.workItems.$inferInsert> = {
    updatedAt: nowIso(),
  };
  if (args.title !== undefined) set.title = args.title;
  if (args.body !== undefined) set.body = args.body;
  if (args.status !== undefined) set.status = args.status;
  if (args.priority !== undefined) set.priority = args.priority;
  if (args.assigneeEmail !== undefined) set.assigneeEmail = args.assigneeEmail;
  if (args.teamId !== undefined) set.teamId = args.teamId;
  if (args.tags !== undefined)
    set.tagsJson = JSON.stringify(normalizeTags(args.tags));
  if (args.metadata !== undefined) {
    const merged = {
      ...parseJson<Record<string, unknown>>(existing.metadataJson, {}),
      ...args.metadata,
    };
    set.metadataJson = stableJson(merged);
  }
  if (args.dueAt !== undefined) set.dueAt = args.dueAt;

  await getDb()
    .update(schema.workItems)
    .set(set)
    .where(eq(schema.workItems.id, args.id));
  return getWorkItem(args.id);
}

export async function listRoutingRules() {
  const rows = await getDb()
    .select()
    .from(schema.routingRules)
    .where(accessFilter(schema.routingRules, schema.routingRuleShares))
    .orderBy(schema.routingRules.priority, desc(schema.routingRules.updatedAt));
  return rows.map((rule) => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    priority: rule.priority,
    match: parseJson<RoutingRuleMatch>(rule.matchJson, {}),
    assignToEmail: rule.assignToEmail,
    assignToTeamId: rule.assignToTeamId,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  }));
}

export async function upsertRoutingRule(
  input: z.input<typeof routingRuleInputSchema>,
) {
  const args = routingRuleInputSchema.parse(input);
  const db = getDb();
  const { userEmail, orgId } = currentAccess();
  if (!userEmail) {
    throw new Error("upsert-routing-rule requires an authenticated user.");
  }
  const timestamp = nowIso();

  if (args.id) {
    await assertAccess("delivery_routing_rule", args.id, "editor");
    await db
      .update(schema.routingRules)
      .set({
        name: args.name,
        description: args.description ?? null,
        enabled: args.enabled,
        priority: args.priority,
        matchJson: stableJson(args.match),
        assignToEmail: args.assignToEmail ?? null,
        assignToTeamId: args.assignToTeamId ?? null,
        updatedAt: timestamp,
      })
      .where(eq(schema.routingRules.id, args.id));
    return (await listRoutingRules()).find((rule) => rule.id === args.id);
  }

  const id = createId("rule");
  await db.insert(schema.routingRules).values({
    id,
    name: args.name,
    description: args.description ?? null,
    enabled: args.enabled,
    priority: args.priority,
    matchJson: stableJson(args.match),
    assignToEmail: args.assignToEmail ?? null,
    assignToTeamId: args.assignToTeamId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ownerEmail: userEmail,
    orgId: orgId ?? null,
    visibility: "private",
  });
  return (await listRoutingRules()).find((rule) => rule.id === id);
}
