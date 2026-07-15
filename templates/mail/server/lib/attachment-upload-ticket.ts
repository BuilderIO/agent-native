import crypto from "node:crypto";

import { getDbExec, isPostgres } from "@agent-native/core/db";
import { getUserSetting } from "@agent-native/core/settings";
import { nanoid } from "nanoid";

import { extensionForUpload, mimeTypeForUpload } from "./media-upload.js";

const SETTING_KEY = "mail-attachment-upload-ticket";
const TICKET_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_TICKETS = 20;
const MAX_CAS_ATTEMPTS = 8;

export interface AttachmentUploadTicket extends Record<string, unknown> {
  uploadId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  tokenHash: string;
  expiresAt: number;
}

interface AttachmentUploadTickets extends Record<string, unknown> {
  tickets: Record<string, AttachmentUploadTicket>;
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function encodeOwner(ownerEmail: string): string {
  return Buffer.from(ownerEmail, "utf8").toString("base64url");
}

function decodeOwner(token: string): string | null {
  const ownerPart = token.split(".", 1)[0];
  if (!ownerPart) return null;
  try {
    const owner = Buffer.from(ownerPart, "base64url").toString("utf8");
    return owner.includes("@") ? owner : null;
  } catch {
    return null;
  }
}

function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function settingStorageKey(ownerEmail: string): string {
  return `u:${ownerEmail}:${SETTING_KEY}`;
}

function settingsTable(): string {
  return isPostgres() ? "public.settings" : "settings";
}

function parseTickets(raw: string | null): AttachmentUploadTickets {
  if (!raw) return { tickets: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<AttachmentUploadTickets>;
    if (!parsed.tickets || typeof parsed.tickets !== "object") {
      return { tickets: {} };
    }
    return {
      tickets: Object.fromEntries(
        Object.entries(parsed.tickets).filter(
          ([uploadId, ticket]) =>
            uploadId &&
            ticket &&
            typeof ticket === "object" &&
            ticket.uploadId === uploadId,
        ),
      ),
    };
  } catch {
    return { tickets: {} };
  }
}

function pruneTickets(
  tickets: Record<string, AttachmentUploadTicket>,
  now: number,
): Record<string, AttachmentUploadTicket> {
  return Object.fromEntries(
    Object.entries(tickets)
      .filter(
        ([, ticket]) =>
          Number.isFinite(ticket.expiresAt) && ticket.expiresAt >= now,
      )
      .sort(([, left], [, right]) => right.expiresAt - left.expiresAt)
      .slice(0, MAX_PENDING_TICKETS),
  );
}

async function readTicketsRow(
  ownerEmail: string,
): Promise<{ raw: string | null; collection: AttachmentUploadTickets }> {
  // This initializes the framework-owned settings table without duplicating
  // its schema/startup logic. The raw read below deliberately bypasses the
  // per-request settings cache because compare-and-swap retries need fresh data.
  await getUserSetting(ownerEmail, SETTING_KEY);
  const { rows } = await getDbExec().execute({
    sql: `SELECT value FROM ${settingsTable()} WHERE key = ?`,
    args: [settingStorageKey(ownerEmail)],
  });
  const raw = rows.length ? String(rows[0].value ?? rows[0][0]) : null;
  return { raw, collection: parseTickets(raw) };
}

async function compareAndSwapTickets(
  ownerEmail: string,
  expectedRaw: string | null,
  collection: AttachmentUploadTickets,
): Promise<boolean> {
  const value = JSON.stringify(collection);
  const key = settingStorageKey(ownerEmail);
  const client = getDbExec();
  if (expectedRaw === null) {
    const result = await client.execute({
      sql: isPostgres()
        ? `INSERT INTO ${settingsTable()} (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING`
        : `INSERT OR IGNORE INTO ${settingsTable()} (key, value, updated_at) VALUES (?, ?, ?)`,
      args: [key, value, Date.now()],
    });
    return result.rowsAffected === 1;
  }
  const result = await client.execute({
    sql: `UPDATE ${settingsTable()} SET value = ?, updated_at = ? WHERE key = ? AND value = ?`,
    args: [value, Date.now(), key, expectedRaw],
  });
  return result.rowsAffected === 1;
}

export async function createAttachmentUploadTicket(
  ownerEmail: string,
  originalName: string,
): Promise<AttachmentUploadTicket & { token: string }> {
  const uploadId = nanoid(12);
  const filename = `${uploadId}${extensionForUpload(originalName)}`;
  const token = `${encodeOwner(ownerEmail)}.${crypto.randomBytes(32).toString("base64url")}`;
  const ticket: AttachmentUploadTicket = {
    uploadId,
    filename,
    originalName,
    mimeType: mimeTypeForUpload(originalName),
    tokenHash: tokenHash(token),
    expiresAt: Date.now() + TICKET_TTL_MS,
  };

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const { raw, collection } = await readTicketsRow(ownerEmail);
    const tickets = pruneTickets(
      // Put the new ticket first so stable sorting keeps it when many tickets
      // share the same millisecond expiry at the collection limit.
      { [uploadId]: ticket, ...collection.tickets },
      Date.now(),
    );
    if (await compareAndSwapTickets(ownerEmail, raw, { tickets })) {
      return { ...ticket, token };
    }
  }
  throw new Error("Could not reserve an attachment upload ticket");
}

export async function verifyAttachmentUploadTicket(
  uploadId: string,
  token: string,
): Promise<{ ownerEmail: string; ticket: AttachmentUploadTicket } | null> {
  const ownerEmail = decodeOwner(token);
  if (!ownerEmail) return null;

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const { raw, collection } = await readTicketsRow(ownerEmail);
    const tickets = pruneTickets(collection.tickets, Date.now());
    const ticket = tickets[uploadId];
    if (JSON.stringify(tickets) !== JSON.stringify(collection.tickets)) {
      if (!(await compareAndSwapTickets(ownerEmail, raw, { tickets })))
        continue;
    }
    if (
      !ticket ||
      typeof ticket.tokenHash !== "string" ||
      !hashesMatch(ticket.tokenHash, tokenHash(token))
    ) {
      return null;
    }
    return { ownerEmail, ticket };
  }
  return null;
}

/**
 * Atomically validates and removes a one-time upload capability.
 *
 * The caller must claim immediately before the storage side effect. Once this
 * returns a ticket it cannot be reclaimed, even if storage later fails. That
 * fail-closed behavior prevents retries from turning an ambiguous write into a
 * replay vulnerability.
 */
export async function claimAttachmentUploadTicket(
  uploadId: string,
  token: string,
): Promise<{ ownerEmail: string; ticket: AttachmentUploadTicket } | null> {
  const ownerEmail = decodeOwner(token);
  if (!ownerEmail) return null;

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const { raw, collection } = await readTicketsRow(ownerEmail);
    const tickets = pruneTickets(collection.tickets, Date.now());
    const ticket = tickets[uploadId];
    if (
      !ticket ||
      typeof ticket.tokenHash !== "string" ||
      !hashesMatch(ticket.tokenHash, tokenHash(token))
    ) {
      if (JSON.stringify(tickets) !== JSON.stringify(collection.tickets)) {
        if (!(await compareAndSwapTickets(ownerEmail, raw, { tickets }))) {
          continue;
        }
      }
      return null;
    }

    delete tickets[uploadId];
    if (await compareAndSwapTickets(ownerEmail, raw, { tickets })) {
      return { ownerEmail, ticket };
    }
  }
  return null;
}
