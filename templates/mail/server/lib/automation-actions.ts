import { notify } from "@agent-native/core/notifications";
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
  signal?: AbortSignal;
  from?: string;
  subject?: string;
  snippet?: string;
}

export async function buildLabelCache(
  accessToken: string,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  try {
    const res = await gmailListLabels(accessToken, signal);
    signal?.throwIfAborted();
    for (const label of res.labels || []) {
      if (label.id && label.name) {
        cache.set(label.name.toLowerCase(), label.id);
      }
    }
  } catch (err) {
    if (signal?.aborted) signal.throwIfAborted();
    if (err instanceof Error && err.name === "AbortError") throw err;
    console.error("[automation-actions] Failed to load labels:", err);
  }
  return cache;
}

export async function ensureGmailLabel(
  accessToken: string,
  labelName: string,
  labelCache: Map<string, string>,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const key = labelName.toLowerCase();
  const existing = labelCache.get(key);
  if (existing) return existing;

  try {
    const created = await gmailCreateLabel(
      accessToken,
      labelName,
      undefined,
      signal,
    );
    signal?.throwIfAborted();
    if (created.id) {
      labelCache.set(key, created.id);
      return created.id;
    }
  } catch (err: any) {
    if (signal?.aborted) signal.throwIfAborted();
    if (err instanceof Error && err.name === "AbortError") throw err;
    const refreshed = await buildLabelCache(accessToken, signal);
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
  ctx.signal?.throwIfAborted();
  const threadId = (
    await findThreadIdsByMessageIds(ctx.ownerEmail, ctx.accountEmail, [
      ctx.messageId,
    ])
  ).get(ctx.messageId);
  ctx.signal?.throwIfAborted();
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
    ctx.signal?.throwIfAborted();
    switch (action.type) {
      case "notify": {
        const notification = await notify(
          {
            severity: "info",
            channels: ["inbox"],
            title: ctx.subject?.trim() || ctx.from?.trim() || ctx.accountEmail,
            body: [ctx.from?.trim(), ctx.snippet?.trim()]
              .filter(Boolean)
              .join(" · "),
            metadata: {
              accountEmail: ctx.accountEmail,
              messageId: ctx.messageId,
            },
          },
          { owner: ctx.ownerEmail },
          { signal: ctx.signal },
        );
        ctx.signal?.throwIfAborted();
        if (!notification) {
          throw new Error("Mail notification was not persisted.");
        }
        return { success: true };
      }
      case "label": {
        const labelId = await ensureGmailLabel(
          ctx.accessToken,
          action.labelName,
          ctx.labelCache,
          ctx.signal,
        );
        ctx.signal?.throwIfAborted();
        const updated = (await gmailModifyMessage(
          ctx.accessToken,
          ctx.messageId,
          [labelId],
          undefined,
          ctx.signal,
        )) as { historyId?: string } | undefined;
        ctx.signal?.throwIfAborted();
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
          ctx.signal,
        )) as { historyId?: string } | undefined;
        ctx.signal?.throwIfAborted();
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
          ctx.signal,
        )) as { historyId?: string } | undefined;
        ctx.signal?.throwIfAborted();
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
          undefined,
          ctx.signal,
        )) as { historyId?: string } | undefined;
        ctx.signal?.throwIfAborted();
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
          ctx.signal,
        )) as { historyId?: string } | undefined;
        ctx.signal?.throwIfAborted();
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
    if (ctx.signal?.aborted) ctx.signal.throwIfAborted();
    if (err instanceof Error && err.name === "AbortError") throw err;
    return { success: false, error: err?.message ?? String(err) };
  }
}

export async function executeActions(
  actions: AutomationAction[],
  ctx: ActionContext,
): Promise<{
  successes: number;
  failures: number;
  failedActions: AutomationAction[];
}> {
  let successes = 0;
  let failures = 0;
  const failedActions: AutomationAction[] = [];
  for (const action of actions) {
    ctx.signal?.throwIfAborted();
    const result = await executeAction(action, ctx);
    ctx.signal?.throwIfAborted();
    if (result.success) successes++;
    else {
      failures++;
      failedActions.push(action);
      console.error(
        `[automation-actions] Action ${action.type} failed for ${ctx.messageId}:`,
        result.error,
      );
    }
  }
  return { successes, failures, failedActions };
}
