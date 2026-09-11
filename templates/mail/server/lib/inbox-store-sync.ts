/**
 * One call site for "a mutation changed Gmail labels, keep the synced inbox
 * store and the list cache in step." Called from `email-state.ts` (the
 * single-item path every mutation action routes through) and from each
 * action's bulk `gmailBatchModifyByAccount` fan-out, since that helper lives
 * in `google-auth.ts` (owned elsewhere) and can't call back into the store.
 *
 * Best-effort: a store row that doesn't exist yet (e.g. a thread synced
 * after this call started) is silently skipped by `applyLocalLabelDelta`,
 * and the next `ensureInboxFresh` / push notification reconciles it — this
 * is an optimistic local patch, not the source of truth.
 */
import { invalidateListCacheForOwner } from "./google-auth.js";
import {
  applyLocalLabelDelta,
  findThreadIdsByMessageIds,
  type LocalLabelDelta,
} from "./inbox-store.js";

export async function syncInboxLabelDelta(
  ownerEmail: string,
  accountEmail: string,
  threadIds: readonly string[],
  delta: LocalLabelDelta,
): Promise<void> {
  const ids = threadIds.filter(Boolean);
  if (ids.length === 0) return;
  await applyLocalLabelDelta(ownerEmail, accountEmail, ids, delta);
  invalidateListCacheForOwner(ownerEmail);
}

/**
 * Same as {@link syncInboxLabelDelta}, but for the `gmailBatchModifyByAccount`
 * bulk fan-out: targets are message ids grouped by account, most without a
 * known threadId. Resolves the missing ones from the store's
 * `message_ids_json` (one lookup per account) instead of an extra Gmail
 * round-trip per message.
 *
 * Every target must already carry the resolved `accountEmail` that the Gmail
 * mutation actually used — see `resolveMutationAccounts` in email-state.ts,
 * which every caller runs before both the Gmail call and this mirror so the
 * two never group by different rules. A target with no resolved account is
 * dropped rather than guessed at (no owner-email fallback): this is a
 * best-effort optimistic mirror, not the source of truth, and a silent guess
 * here is exactly the staleness bug this function exists to avoid.
 */
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
      const missingIds = items.filter((i) => !i.threadId).map((i) => i.id);
      const resolved = missingIds.length
        ? await findThreadIdsByMessageIds(ownerEmail, accountEmail, missingIds)
        : new Map<string, string>();
      const threadIds = new Set<string>();
      for (const item of items) {
        const threadId = item.threadId ?? resolved.get(item.id);
        if (threadId) threadIds.add(threadId);
      }
      await syncInboxLabelDelta(ownerEmail, accountEmail, [...threadIds], {
        ...delta,
        ...(delta.scope === "message"
          ? { messageIds: items.map((i) => i.id) }
          : {}),
      });
    }),
  );
}
