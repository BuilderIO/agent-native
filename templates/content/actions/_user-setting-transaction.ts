import { getSetting, getSettingsEmitter } from "@agent-native/core/settings";
import { sql, type SQL } from "drizzle-orm";

interface SettingsTransaction {
  execute(query: SQL): Promise<unknown>;
}

type TransactionMutation<T> = {
  value: Record<string, unknown> | null;
  result: T;
};

function userKey(email: string, key: string): string {
  return `u:${email.trim().toLowerCase()}:${key}`;
}

function legacyUserKey(email: string, key: string): string {
  return `u:${email}:${key}`;
}

function transactionRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

export async function mutateContentUserSettingTransaction<
  TTransaction extends SettingsTransaction,
  TResult,
>(
  runTransaction: <T>(callback: (tx: TTransaction) => Promise<T>) => Promise<T>,
  email: string,
  key: string,
  updater: (
    tx: TTransaction,
    current: Record<string, unknown> | null,
  ) => Promise<TransactionMutation<TResult>> | TransactionMutation<TResult>,
): Promise<TransactionMutation<TResult>> {
  const normalized = userKey(email, key);
  const legacy = legacyUserKey(email, key);

  await getSetting(normalized, { bypassCache: true });

  const mutation = await runTransaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${normalized}, 0::bigint))`,
    );
    const currentResult = await tx.execute(
      sql`SELECT value FROM public.settings WHERE key = ${normalized} FOR UPDATE`,
    );
    const currentRow = transactionRows(currentResult)[0];
    let current = currentRow?.value
      ? (JSON.parse(String(currentRow.value)) as Record<string, unknown>)
      : null;
    if (current === null && legacy !== normalized) {
      const fallbackResult = await tx.execute(
        sql`SELECT value FROM public.settings WHERE key = ${legacy} FOR UPDATE`,
      );
      const fallbackRow = transactionRows(fallbackResult)[0];
      current = fallbackRow?.value
        ? (JSON.parse(String(fallbackRow.value)) as Record<string, unknown>)
        : null;
    }

    const next = await updater(tx, current);
    if (next.value === null) {
      await tx.execute(
        sql`DELETE FROM public.settings WHERE key = ${normalized}`,
      );
    } else {
      await tx.execute(sql`
        INSERT INTO public.settings (key, value, updated_at)
        VALUES (${normalized}, ${JSON.stringify(next.value)}, ${Date.now()})
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `);
    }
    if (legacy !== normalized) {
      await tx.execute(sql`DELETE FROM public.settings WHERE key = ${legacy}`);
    }
    return next;
  });

  getSettingsEmitter().emit("settings", {
    source: "settings",
    type: mutation.value === null ? "delete" : "change",
    key: normalized,
  });
  return mutation;
}
