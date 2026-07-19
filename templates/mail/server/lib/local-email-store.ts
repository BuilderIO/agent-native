import { AsyncLocalStorage } from "node:async_hooks";

import { getDbExec, isPostgres } from "@agent-native/core/db";
import {
  getSettingsEmitter,
  getUserSetting,
  type StoreWriteOptions,
} from "@agent-native/core/settings";
import type { EmailMessage } from "@shared/types.js";
import { nanoid } from "nanoid";

const localEmailMutationLocks = new Map<string, Promise<unknown>>();
const LOCK_SETTING_KEY = "local-emails-mutation-lock";
const LOCK_LEASE_MS = 60_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 25;
const LOCK_RELEASE_ATTEMPTS = 3;
const MAX_MUTATION_ATTEMPTS = 8;

interface LocalEmailMutationContext {
  ownerKey: string;
  expectedMailboxRaw?: string | null;
}

class LocalEmailWriteConflict extends Error {}

const localEmailMutationContext =
  new AsyncLocalStorage<LocalEmailMutationContext>();

interface LocalEmailLease {
  token: string;
  expiresAt: number;
}

function settingsTable(): string {
  return isPostgres() ? "public.settings" : "settings";
}

function lockStorageKey(ownerEmail: string): string {
  return `u:${ownerEmail.toLowerCase()}:${LOCK_SETTING_KEY}`;
}

function mailboxStorageKey(ownerEmail: string): string {
  return `u:${ownerEmail}:local-emails`;
}

function parseLease(raw: string | null): LocalEmailLease | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalEmailLease>;
    if (
      typeof parsed.token === "string" &&
      typeof parsed.expiresAt === "number"
    ) {
      return { token: parsed.token, expiresAt: parsed.expiresAt };
    }
  } catch {}
  return null;
}

async function readLeaseRow(
  ownerEmail: string,
): Promise<{ raw: string | null; lease: LocalEmailLease | null }> {
  // Initialize the framework-owned settings table, then bypass the request
  // settings cache so every lease attempt sees the latest committed owner row.
  await getUserSetting(ownerEmail, LOCK_SETTING_KEY);
  const { rows } = await getDbExec().execute({
    sql: `SELECT value FROM ${settingsTable()} WHERE key = ?`,
    args: [lockStorageKey(ownerEmail)],
  });
  const raw = rows.length ? String(rows[0].value ?? rows[0][0]) : null;
  return { raw, lease: parseLease(raw) };
}

async function compareAndSwapLease(
  ownerEmail: string,
  expectedRaw: string | null,
  nextRaw: string,
): Promise<boolean> {
  const client = getDbExec();
  const key = lockStorageKey(ownerEmail);
  if (expectedRaw === null) {
    const result = await client.execute({
      sql: isPostgres()
        ? `INSERT INTO ${settingsTable()} (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING`
        : `INSERT OR IGNORE INTO ${settingsTable()} (key, value, updated_at) VALUES (?, ?, ?)`,
      args: [key, nextRaw, Date.now()],
    });
    return result.rowsAffected === 1;
  }
  const result = await client.execute({
    sql: `UPDATE ${settingsTable()} SET value = ?, updated_at = ? WHERE key = ? AND value = ?`,
    args: [nextRaw, Date.now(), key, expectedRaw],
  });
  return result.rowsAffected === 1;
}

async function acquireDatabaseLease(ownerEmail: string): Promise<string> {
  const token = nanoid(16);
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { raw, lease } = await readLeaseRow(ownerEmail);
    const now = Date.now();
    if (!lease || lease.expiresAt <= now) {
      const nextRaw = JSON.stringify({
        token,
        expiresAt: now + LOCK_LEASE_MS,
      } satisfies LocalEmailLease);
      if (await compareAndSwapLease(ownerEmail, raw, nextRaw)) return nextRaw;
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
  }
  throw new Error("Timed out waiting for local mailbox mutation lock");
}

async function releaseDatabaseLease(
  ownerEmail: string,
  leaseRaw: string,
): Promise<void> {
  for (let attempt = 0; attempt < LOCK_RELEASE_ATTEMPTS; attempt += 1) {
    try {
      await getDbExec().execute({
        sql: `DELETE FROM ${settingsTable()} WHERE key = ? AND value = ?`,
        args: [lockStorageKey(ownerEmail), leaseRaw],
      });
      return;
    } catch (error) {
      if (attempt === LOCK_RELEASE_ATTEMPTS - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}

async function readMailboxRow(ownerEmail: string): Promise<string | null> {
  // Initialize the settings table, then bypass its request cache so CAS retry
  // attempts always compare against the latest committed mailbox snapshot.
  await getUserSetting(ownerEmail, "local-emails");
  const { rows } = await getDbExec().execute({
    sql: `SELECT value FROM ${settingsTable()} WHERE key = ?`,
    args: [mailboxStorageKey(ownerEmail)],
  });
  return rows.length ? String(rows[0].value ?? rows[0][0]) : null;
}

function parseEmails(raw: string | null): EmailMessage[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data?.emails) ? data.emails : [];
  } catch {
    return [];
  }
}

async function compareAndSwapMailbox(
  ownerEmail: string,
  expectedRaw: string | null,
  nextRaw: string,
): Promise<boolean> {
  const client = getDbExec();
  const key = mailboxStorageKey(ownerEmail);
  if (expectedRaw === null) {
    const result = await client.execute({
      sql: isPostgres()
        ? `INSERT INTO ${settingsTable()} (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING`
        : `INSERT OR IGNORE INTO ${settingsTable()} (key, value, updated_at) VALUES (?, ?, ?)`,
      args: [key, nextRaw, Date.now()],
    });
    return result.rowsAffected === 1;
  }
  const result = await client.execute({
    sql: `UPDATE ${settingsTable()} SET value = ?, updated_at = ? WHERE key = ? AND value = ?`,
    args: [nextRaw, Date.now(), key, expectedRaw],
  });
  return result.rowsAffected === 1;
}

/**
 * Serialize read-modify-write operations on an owner's synthetic mailbox.
 * Local mail is one JSON document, so every writer must participate to avoid
 * replacing a concurrent writer's newer snapshot.
 */
export function withLocalEmailMutationLock<T>(
  ownerEmail: string,
  mutate: () => Promise<T>,
): Promise<T> {
  const key = ownerEmail.toLowerCase();
  const previous = localEmailMutationLocks.get(key) ?? Promise.resolve();
  const runWithDatabaseLease = async () => {
    for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt += 1) {
      const leaseRaw = await acquireDatabaseLease(ownerEmail);
      try {
        return await localEmailMutationContext.run({ ownerKey: key }, mutate);
      } catch (error) {
        if (!(error instanceof LocalEmailWriteConflict)) throw error;
      } finally {
        try {
          await releaseDatabaseLease(ownerEmail, leaseRaw);
        } catch (error) {
          // The lease expires and is token-scoped, so a transient cleanup
          // failure must not turn an already committed mailbox write into an
          // ambiguous failure that callers may retry.
          console.warn(
            "[local-email-store] failed to release mutation lease; it will expire",
            error,
          );
        }
      }
    }
    throw new Error("Local mailbox changed too many times; please retry");
  };
  const next = previous.then(runWithDatabaseLease, runWithDatabaseLease);
  localEmailMutationLocks.set(key, next);
  const cleanup = () => {
    if (localEmailMutationLocks.get(key) === next) {
      localEmailMutationLocks.delete(key);
    }
  };
  next.then(cleanup, cleanup);
  return next;
}

export async function readLocalEmails(
  ownerEmail: string,
): Promise<EmailMessage[]> {
  const raw = await readMailboxRow(ownerEmail);
  const context = localEmailMutationContext.getStore();
  if (context?.ownerKey === ownerEmail.toLowerCase()) {
    context.expectedMailboxRaw = raw;
  }
  return parseEmails(raw);
}

export async function writeLocalEmails(
  ownerEmail: string,
  emails: EmailMessage[],
  options?: StoreWriteOptions,
): Promise<void> {
  const context = localEmailMutationContext.getStore();
  if (
    context?.ownerKey !== ownerEmail.toLowerCase() ||
    context.expectedMailboxRaw === undefined
  ) {
    throw new Error(
      "Local mailbox writes must run inside withLocalEmailMutationLock after a fresh read",
    );
  }
  const nextRaw = JSON.stringify({ emails });
  if (
    !(await compareAndSwapMailbox(
      ownerEmail,
      context.expectedMailboxRaw,
      nextRaw,
    ))
  ) {
    throw new LocalEmailWriteConflict("Local mailbox changed concurrently");
  }
  context.expectedMailboxRaw = nextRaw;
  getSettingsEmitter().emit("settings", {
    source: "settings",
    type: "change",
    key: mailboxStorageKey(ownerEmail),
    ...(options?.requestSource && { requestSource: options.requestSource }),
  });
}
