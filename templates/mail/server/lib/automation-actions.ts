import type { AutomationAction } from "@shared/types.js";

import {
  gmailModifyMessage,
  gmailTrashMessage,
  gmailListLabels,
  gmailCreateLabel,
} from "./google-api.js";
import { syncInboxLabelDelta } from "./inbox-store-sync.js";
import { findThreadIdsByMessageIds } from "./inbox-store.js";

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
export async function ensureGmailLabel(
  accessToken: string,
  labelName: string,
  labelCache: Map<string, string>,
): Promise<string> {
  const key = labelName.toLowerCase();
  const existing = labelCache.get(key);
  if (existing) return existing;

  // Create the label
  try {
    const created = await gmailCreateLabel(accessToken, labelName);
    if (created.id) {
      labelCache.set(key, created.id);
      return created.id;
    }
  } catch (err: any) {
    // Label might already exist (race condition) — try to find it
    const refreshed = await buildLabelCache(accessToken);
    for (const [k, v] of refreshed) labelCache.set(k, v);
    const retryId = labelCache.get(key);
    if (retryId) return retryId;
    throw err;
  }

  throw new Error(`Failed to create or find label "${labelName}"`);
}

/**
 * Mirror an automation's Gmail mutation into the synced inbox store,
 * best-effort: resolves the message's threadId from the store's own
 * `message_ids_json` (no extra Gmail round-trip) and skips silently when the
 * message hasn't synced yet — the next history sync reconciles it, same as
 * every other optimistic store patch.
 */
async function mirrorStoreDelta(
  ctx: ActionContext,
  delta: { add?: string[]; remove?: string[] },
): Promise<void> {
  const threadId = (
    await findThreadIdsByMessageIds(ctx.ownerEmail, ctx.accountEmail, [
      ctx.messageId,
    ])
  ).get(ctx.messageId);
  if (!threadId) return;
  await syncInboxLabelDelta(ctx.ownerEmail, ctx.accountEmail, [threadId], {
    ...delta,
    scope: "message",
    messageIds: [ctx.messageId],
  });
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
        const labelId = await ensureGmailLabel(
          ctx.accessToken,
          action.labelName,
          ctx.labelCache,
        );
        await gmailModifyMessage(ctx.accessToken, ctx.messageId, [labelId]);
        await mirrorStoreDelta(ctx, { add: [labelId] });
        return { success: true };
      }
      case "archive":
        await gmailModifyMessage(ctx.accessToken, ctx.messageId, undefined, [
          "INBOX",
        ]);
        await mirrorStoreDelta(ctx, { remove: ["INBOX"] });
        return { success: true };
      case "mark_read":
        await gmailModifyMessage(ctx.accessToken, ctx.messageId, undefined, [
          "UNREAD",
        ]);
        await mirrorStoreDelta(ctx, { remove: ["UNREAD"] });
        return { success: true };
      case "star":
        await gmailModifyMessage(ctx.accessToken, ctx.messageId, ["STARRED"]);
        await mirrorStoreDelta(ctx, { add: ["STARRED"] });
        return { success: true };
      case "trash":
        await gmailTrashMessage(ctx.accessToken, ctx.messageId);
        // Gmail's messages.trash contract: adds TRASH, removes INBOX.
        await mirrorStoreDelta(ctx, { add: ["TRASH"], remove: ["INBOX"] });
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
