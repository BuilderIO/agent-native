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
  labelCache: Map<string, string>;
}

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

export async function ensureGmailLabel(
  accessToken: string,
  labelName: string,
  labelCache: Map<string, string>,
): Promise<string> {
  const key = labelName.toLowerCase();
  const existing = labelCache.get(key);
  if (existing) return existing;

  try {
    const created = await gmailCreateLabel(accessToken, labelName);
    if (created.id) {
      labelCache.set(key, created.id);
      return created.id;
    }
  } catch (err: any) {
    const refreshed = await buildLabelCache(accessToken);
    for (const [k, v] of refreshed) labelCache.set(k, v);
    const retryId = labelCache.get(key);
    if (retryId) return retryId;
    throw err;
  }

  throw new Error(`Failed to create or find label "${labelName}"`);
}

async function mirrorStoreDelta(
  ctx: ActionContext,
  delta: {
    add?: string[];
    remove?: string[];
    providerHistoryId?: string;
  },
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
        const updated = (await gmailModifyMessage(
          ctx.accessToken,
          ctx.messageId,
          [labelId],
        )) as { historyId?: string } | undefined;
        await mirrorStoreDelta(ctx, {
          add: [labelId],
          providerHistoryId: updated?.historyId,
        });
        return { success: true };
      }
      case "archive": {
        const updated = (await gmailModifyMessage(
          ctx.accessToken,
          ctx.messageId,
          undefined,
          ["INBOX"],
        )) as { historyId?: string } | undefined;
        await mirrorStoreDelta(ctx, {
          remove: ["INBOX"],
          providerHistoryId: updated?.historyId,
        });
        return { success: true };
      }
      case "mark_read": {
        const updated = (await gmailModifyMessage(
          ctx.accessToken,
          ctx.messageId,
          undefined,
          ["UNREAD"],
        )) as { historyId?: string } | undefined;
        await mirrorStoreDelta(ctx, {
          remove: ["UNREAD"],
          providerHistoryId: updated?.historyId,
        });
        return { success: true };
      }
      case "star": {
        const updated = (await gmailModifyMessage(
          ctx.accessToken,
          ctx.messageId,
          ["STARRED"],
        )) as { historyId?: string } | undefined;
        await mirrorStoreDelta(ctx, {
          add: ["STARRED"],
          providerHistoryId: updated?.historyId,
        });
        return { success: true };
      }
      case "trash": {
        const updated = (await gmailTrashMessage(
          ctx.accessToken,
          ctx.messageId,
        )) as { historyId?: string } | undefined;
        await mirrorStoreDelta(ctx, {
          add: ["TRASH"],
          remove: ["INBOX"],
          providerHistoryId: updated?.historyId,
        });
        return { success: true };
      }
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
