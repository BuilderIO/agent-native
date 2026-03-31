import type { AutomationAction } from "@shared/types.js";
import {
  gmailModifyMessage,
  gmailTrashMessage,
  gmailListLabels,
  gmailCreateLabel,
} from "./google-api.js";

export interface ActionContext {
  accessToken: string;
  messageId: string;
  ownerEmail: string;
  accountEmail: string;
  labelCache: Map<string, string>; // lowercase name → Gmail label ID
}

/**
 * Build a label name→id cache from the user's Gmail labels.
 */
export async function buildLabelCache(
  accessToken: string,
): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  try {
    const res = await gmailListLabels(accessToken);
    for (const label of res.labels || []) {
      if (label.id && label.name) {
        cache.set(label.name.toLowerCase(), label.id);
      }
    }
  } catch (err) {
    console.error("[automation-actions] Failed to load labels:", err);
  }
  return cache;
}

/**
 * Resolve a label name to a Gmail label ID, creating the label if needed.
 */
async function resolveLabelId(
  labelName: string,
  ctx: ActionContext,
): Promise<string> {
  const key = labelName.toLowerCase();
  const existing = ctx.labelCache.get(key);
  if (existing) return existing;

  // Create the label
  try {
    const created = await gmailCreateLabel(ctx.accessToken, labelName);
    if (created.id) {
      ctx.labelCache.set(key, created.id);
      return created.id;
    }
  } catch (err: any) {
    // Label might already exist (race condition) — try to find it
    const refreshed = await buildLabelCache(ctx.accessToken);
    for (const [k, v] of refreshed) ctx.labelCache.set(k, v);
    const retryId = ctx.labelCache.get(key);
    if (retryId) return retryId;
    throw err;
  }

  throw new Error(`Failed to create or find label "${labelName}"`);
}

/**
 * Execute a single automation action against a Gmail message.
 */
export async function executeAction(
  action: AutomationAction,
  ctx: ActionContext,
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (action.type) {
      case "label": {
        const labelId = await resolveLabelId(action.labelName, ctx);
        await gmailModifyMessage(ctx.accessToken, ctx.messageId, [labelId]);
        return { success: true };
      }
      case "archive":
        await gmailModifyMessage(ctx.accessToken, ctx.messageId, undefined, [
          "INBOX",
        ]);
        return { success: true };
      case "mark_read":
        await gmailModifyMessage(ctx.accessToken, ctx.messageId, undefined, [
          "UNREAD",
        ]);
        return { success: true };
      case "star":
        await gmailModifyMessage(ctx.accessToken, ctx.messageId, ["STARRED"]);
        return { success: true };
      case "trash":
        await gmailTrashMessage(ctx.accessToken, ctx.messageId);
        return { success: true };
      default:
        return {
          success: false,
          error: `Unknown action type: ${(action as any).type}`,
        };
    }
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

/**
 * Execute all actions for a matched rule against a message.
 */
export async function executeActions(
  actions: AutomationAction[],
  ctx: ActionContext,
): Promise<{ successes: number; failures: number }> {
  let successes = 0;
  let failures = 0;
  for (const action of actions) {
    const result = await executeAction(action, ctx);
    if (result.success) successes++;
    else {
      failures++;
      console.error(
        `[automation-actions] Action ${action.type} failed for ${ctx.messageId}:`,
        result.error,
      );
    }
  }
  return { successes, failures };
}
