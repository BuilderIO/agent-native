import {
  invalidateHistoryCacheForAccount,
  invalidateListCacheForOwner,
} from "./google-auth.js";
import {
  applyLocalLabelDelta,
  findThreadIdsByMessageIds,
  type LocalLabelDelta,
} from "./inbox-store.js";

function invalidateInboxCaches(ownerEmail: string, accountEmail: string): void {
  invalidateHistoryCacheForAccount(accountEmail);
  invalidateListCacheForOwner(ownerEmail);
}

async function applyLocalLabelDeltaBestEffort(
  ownerEmail: string,
  accountEmail: string,
  threadIds: string[],
  delta: LocalLabelDelta,
): Promise<void> {
  try {
    await applyLocalLabelDelta(ownerEmail, accountEmail, threadIds, delta);
  } catch (error) {
    console.error("[inbox-store-sync] mirror failed", {
      ownerEmail,
      accountEmail,
      threadIds: threadIds.length,
      error,
    });
  }
}

export async function syncInboxLabelDelta(
  ownerEmail: string,
  accountEmail: string,
  threadIds: readonly string[],
  delta: LocalLabelDelta,
): Promise<void> {
  const ids = threadIds.filter(Boolean);
  if (ids.length === 0) return;
  invalidateInboxCaches(ownerEmail, accountEmail);
  await applyLocalLabelDeltaBestEffort(ownerEmail, accountEmail, ids, delta);
}

export async function syncInboxLabelDeltaForTargets(
  ownerEmail: string,
  targets: ReadonlyArray<{
    id: string;
    threadId?: string;
    accountEmail?: string;
  }>,
  delta: LocalLabelDelta,
): Promise<void> {
  const byAccount = new Map<string, Array<{ id: string; threadId?: string }>>();
  for (const t of targets) {
    if (!t.accountEmail) continue;
    const account = t.accountEmail.toLowerCase();
    const list = byAccount.get(account);
    if (list) list.push(t);
    else byAccount.set(account, [t]);
  }

  await Promise.all(
    [...byAccount.entries()].map(async ([accountEmail, items]) => {
      invalidateInboxCaches(ownerEmail, accountEmail);
      const missingIds = items.filter((i) => !i.threadId).map((i) => i.id);
      let resolved: Map<string, string>;
      try {
        resolved = missingIds.length
          ? await findThreadIdsByMessageIds(
              ownerEmail,
              accountEmail,
              missingIds,
            )
          : new Map<string, string>();
      } catch (error) {
        console.error("[inbox-store-sync] bulk mirror lookup failed", {
          ownerEmail,
          accountEmail,
          messageIds: missingIds.length,
          error,
        });
        resolved = new Map();
      }
      const threadIds = new Set<string>();
      for (const item of items) {
        const threadId = item.threadId ?? resolved.get(item.id);
        if (threadId) threadIds.add(threadId);
      }
      if (threadIds.size === 0) return;
      await applyLocalLabelDeltaBestEffort(
        ownerEmail,
        accountEmail,
        [...threadIds],
        {
          ...delta,
          ...(delta.scope === "message"
            ? { messageIds: items.map((i) => i.id) }
            : {}),
        },
      );
    }),
  );
}
