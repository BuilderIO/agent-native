import { randomUUID } from "node:crypto";

import type { ActionRunContext } from "@agent-native/core/action";

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

/**
 * Persist a bounded, source-linked explanation of an automation action. The
 * agent run id is the join key to core's automation history; no raw provider
 * payload is copied into this table.
 */
export async function recordFactoryAudit(
  context: ActionRunContext | undefined,
  identity: { userEmail: string; orgId: string },
  input: FactoryAuditInput,
): Promise<void> {
  if (context?.caller !== "automation" || !context.runId) return;
  await getDb()
    .insert(factoryAuditEvents)
    .values({
      id: randomUUID(),
      automationRunId: context.runId,
      automationThreadId: context.threadId ?? null,
      automationName: context.automation?.triggerName ?? null,
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
