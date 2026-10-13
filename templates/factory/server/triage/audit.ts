import { randomUUID } from "node:crypto";

import type { ActionRunContext } from "@agent-native/core/action";
import { and, desc, eq } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { factoryAuditEvents } from "../db/schema.js";

const MAX_SUMMARY_LENGTH = 500;
const MAX_DETAILS_LENGTH = 4_000;

export type FactoryAuditKind =
  | "observed"
  | "read"
  | "decision"
  | "external_action"
  | "governance";

export type FactoryAuditStatus = "success" | "error" | "skipped";

export interface FactoryAuditInput {
  action: string;
  kind: FactoryAuditKind;
  status?: FactoryAuditStatus;
  factoryId?: string | null;
  itemId?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  summary: string;
  details?: Record<string, unknown>;
}

function boundedText(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function boundedDetails(value: Record<string, unknown> | undefined): string {
  if (!value) return "{}";
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("Factory audit details are not serializable.");
  }
  return serialized.length > MAX_DETAILS_LENGTH
    ? JSON.stringify({ truncated: true })
    : serialized;
}

export async function recordFactoryAutomationRunPrompt(input: {
  identity: { userEmail: string; orgId: string };
  automationRunId: string;
  factoryId: string;
  path: string;
  promptVersion: number | null;
  executionPromptHash: string;
}): Promise<void> {
  await getDb()
    .insert(factoryAuditEvents)
    .values({
      id: randomUUID(),
      automationRunId: input.automationRunId,
      automationThreadId: null,
      automationName: null,
      factoryId: input.factoryId,
      itemId: null,
      source: null,
      sourceUrl: null,
      action: "automation-run-prompt",
      kind: "governance",
      status: "success",
      summary: boundedText(
        input.promptVersion
          ? `Prompt v${input.promptVersion} · ${input.executionPromptHash.slice(0, 8)}`
          : `Prompt ${input.executionPromptHash.slice(0, 8)}`,
        MAX_SUMMARY_LENGTH,
      ),
      detailsJson: boundedDetails({
        path: input.path,
        promptVersion: input.promptVersion,
        executionPromptHash: input.executionPromptHash,
      }),
      createdAt: new Date().toISOString(),
      ownerEmail: input.identity.userEmail,
      orgId: input.identity.orgId,
    });
}

export async function recordFactoryGovernanceAudit(
  identity: { userEmail: string; orgId: string },
  input: FactoryAuditInput,
  factoryId?: string | null,
): Promise<void> {
  const resolvedFactoryId = factoryId ?? input.factoryId ?? null;
  await getDb()
    .insert(factoryAuditEvents)
    .values({
      id: randomUUID(),
      automationRunId: null,
      automationThreadId: null,
      automationName: null,
      factoryId: resolvedFactoryId,
      itemId: input.itemId ?? null,
      source: input.source ?? null,
      sourceUrl: input.sourceUrl ?? null,
      action: boundedText(input.action, 120),
      kind: input.kind ?? "governance",
      status: input.status ?? "success",
      summary: boundedText(input.summary, MAX_SUMMARY_LENGTH),
      detailsJson: boundedDetails(input.details),
      createdAt: new Date().toISOString(),
      ownerEmail: identity.userEmail,
      orgId: identity.orgId,
    });
}

export async function recordFactoryAudit(
  context: ActionRunContext | undefined,
  identity: { userEmail: string; orgId: string },
  input: FactoryAuditInput,
  factoryId?: string | null,
): Promise<void> {
  if (context?.caller !== "automation" || !context.runId) return;
  const resolvedFactoryId = factoryId ?? input.factoryId ?? null;
  await getDb()
    .insert(factoryAuditEvents)
    .values({
      id: randomUUID(),
      automationRunId: context.runId,
      automationThreadId: context.threadId ?? null,
      automationName: context.automation?.triggerName ?? null,
      factoryId: resolvedFactoryId,
      itemId: input.itemId ?? null,
      source: input.source ?? null,
      sourceUrl: input.sourceUrl ?? null,
      action: boundedText(input.action, 120),
      kind: input.kind,
      status: input.status ?? "success",
      summary: boundedText(input.summary, MAX_SUMMARY_LENGTH),
      detailsJson: boundedDetails(input.details),
      createdAt: new Date().toISOString(),
      ownerEmail: identity.userEmail,
      orgId: identity.orgId,
    });
}

export async function recordFactoryAuditIfChanged(
  context: ActionRunContext | undefined,
  identity: { userEmail: string; orgId: string },
  input: FactoryAuditInput,
  factoryId?: string | null,
): Promise<void> {
  if (context?.caller !== "automation" || !context.runId || !input.itemId) {
    await recordFactoryAudit(context, identity, input, factoryId);
    return;
  }
  const itemId = input.itemId;
  const runId = context.runId;
  const status = input.status ?? "success";
  const summary = boundedText(input.summary, MAX_SUMMARY_LENGTH);
  const action = boundedText(input.action, 120);
  await getDb().transaction(async (tx) => {
    const last = (
      await tx
        .select({
          summary: factoryAuditEvents.summary,
          status: factoryAuditEvents.status,
        })
        .from(factoryAuditEvents)
        .where(
          and(
            eq(factoryAuditEvents.itemId, itemId),
            eq(factoryAuditEvents.action, action),
            eq(factoryAuditEvents.kind, input.kind),
          ),
        )
        .orderBy(desc(factoryAuditEvents.createdAt))
        .limit(1)
    )[0];
    if (last && last.summary === summary && last.status === status) return;
    const resolvedFactoryId = factoryId ?? input.factoryId ?? null;
    await tx.insert(factoryAuditEvents).values({
      id: randomUUID(),
      automationRunId: runId,
      automationThreadId: context.threadId ?? null,
      automationName: context.automation?.triggerName ?? null,
      factoryId: resolvedFactoryId,
      itemId,
      source: input.source ?? null,
      sourceUrl: input.sourceUrl ?? null,
      action,
      kind: input.kind,
      status,
      summary,
      detailsJson: boundedDetails(input.details),
      createdAt: new Date().toISOString(),
      ownerEmail: identity.userEmail,
      orgId: identity.orgId,
    });
  });
}
