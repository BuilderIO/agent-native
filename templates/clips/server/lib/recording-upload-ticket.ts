import crypto from "node:crypto";

import { getDbExec } from "@agent-native/core/db";
import { getUserSetting } from "@agent-native/core/settings";
import { and, eq } from "drizzle-orm";
import { createError, getHeader, type H3Event } from "h3";

import { getDb, schema } from "../db/index.js";
import { ownerEmailMatches } from "./recordings.js";

const SETTING_KEY = "clips-recording-upload-ticket";
const TOKEN_PREFIX = "clipsup_";
// Sized for the 2 GiB cap at ~2.4 Mbps upstream, so a ticket is never renewed
// per chunk. Finalize ends it sooner: the agent chunk route only accepts a
// ticket while its recording is still "uploading".
export const RECORDING_UPLOAD_TICKET_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PENDING_TICKETS = 20;
const MAX_CAS_ATTEMPTS = 8;

export interface RecordingUploadTicket extends Record<string, unknown> {
  recordingId: string;
  orgId?: string;
  tokenHash: string;
  expiresAt: number;
}

interface RecordingUploadTickets extends Record<string, unknown> {
  tickets: Record<string, RecordingUploadTicket>;
}

export interface RecordingUploadTicketOwner {
  recordingId: string;
  ownerEmail: string;
  orgId?: string;
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function encodeOwner(ownerEmail: string): string {
  return Buffer.from(ownerEmail, "utf8").toString("base64url");
}

function decodeOwner(token: string): string | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const ownerPart = token.slice(TOKEN_PREFIX.length).split(".", 1)[0];
  if (!ownerPart) return null;
  const owner = Buffer.from(ownerPart, "base64url").toString("utf8");
  return owner.includes("@") ? owner : null;
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

function parseTickets(raw: string | null): RecordingUploadTickets {
  if (!raw) return { tickets: {} };
  let parsed: Partial<RecordingUploadTickets>;
  try {
    parsed = JSON.parse(raw) as Partial<RecordingUploadTickets>;
  } catch {
    // coercion-ok: an unreadable row holds no usable ticket, so every upload
    // URL it backed is refused; creating a ticket replaces the row.
    return { tickets: {} };
  }
  if (!parsed.tickets || typeof parsed.tickets !== "object") {
    return { tickets: {} };
  }
  return {
    tickets: Object.fromEntries(
      Object.entries(parsed.tickets).filter(
        ([recordingId, ticket]) =>
          recordingId &&
          ticket &&
          typeof ticket === "object" &&
          ticket.recordingId === recordingId,
      ),
    ),
  };
}

function pruneTickets(
  tickets: Record<string, RecordingUploadTicket>,
  now: number,
): Record<string, RecordingUploadTicket> {
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
): Promise<{ raw: string | null; collection: RecordingUploadTickets }> {
  await getUserSetting(ownerEmail, SETTING_KEY);
  const { rows } = await getDbExec().execute({
    sql: "SELECT value FROM public.settings WHERE key = $1",
    args: [settingStorageKey(ownerEmail)],
  });
  const raw = rows.length ? String(rows[0].value ?? rows[0][0]) : null;
  return { raw, collection: parseTickets(raw) };
}

async function compareAndSwapTickets(
  ownerEmail: string,
  expectedRaw: string | null,
  collection: RecordingUploadTickets,
): Promise<boolean> {
  const value = JSON.stringify(collection);
  const key = settingStorageKey(ownerEmail);
  const client = getDbExec();
  if (expectedRaw === null) {
    const result = await client.execute({
      sql: "INSERT INTO public.settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING",
      args: [key, value, Date.now()],
    });
    return result.rowsAffected === 1;
  }
  const result = await client.execute({
    sql: "UPDATE public.settings SET value = $1, updated_at = $2 WHERE key = $3 AND value = $4",
    args: [value, Date.now(), key, expectedRaw],
  });
  return result.rowsAffected === 1;
}

export async function createRecordingUploadTicket(
  ownerEmail: string,
  recordingId: string,
  orgId?: string,
): Promise<RecordingUploadTicket & { token: string }> {
  const token = `${TOKEN_PREFIX}${encodeOwner(ownerEmail)}.${crypto.randomBytes(32).toString("base64url")}`;
  const ticket: RecordingUploadTicket = {
    recordingId,
    ...(orgId ? { orgId } : {}),
    tokenHash: tokenHash(token),
    expiresAt: Date.now() + RECORDING_UPLOAD_TICKET_TTL_MS,
  };

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const { raw, collection } = await readTicketsRow(ownerEmail);
    const tickets = pruneTickets(
      { ...collection.tickets, [recordingId]: ticket },
      Date.now(),
    );
    if (await compareAndSwapTickets(ownerEmail, raw, { tickets })) {
      return { ...ticket, token };
    }
  }
  throw new Error("Could not reserve a recording upload ticket");
}

/** Read-only, so a refused chunk request writes nothing. */
export async function verifyRecordingUploadTicket(
  recordingId: string,
  token: string,
): Promise<{ ownerEmail: string; ticket: RecordingUploadTicket } | null> {
  const ownerEmail = decodeOwner(token);
  if (!ownerEmail) return null;
  const { collection } = await readTicketsRow(ownerEmail);
  const ticket = collection.tickets[recordingId];
  if (
    !ticket ||
    typeof ticket.tokenHash !== "string" ||
    !hashesMatch(ticket.tokenHash, tokenHash(token)) ||
    !Number.isFinite(ticket.expiresAt) ||
    ticket.expiresAt < Date.now()
  ) {
    return null;
  }
  return { ownerEmail, ticket };
}

function readTicketToken(event: H3Event): string | null {
  const authorization = (getHeader(event, "authorization") ?? "").trim();
  if (!authorization.startsWith(`Bearer ${TOKEN_PREFIX}`)) return null;
  return authorization.slice("Bearer ".length);
}

/** Refuses before anything is written unless the ticket opens this recording's live upload. */
export async function requireRecordingUploadTicketOwner(
  event: H3Event,
  recordingId: string,
): Promise<RecordingUploadTicketOwner> {
  const token = readTicketToken(event);
  const verified = token
    ? await verifyRecordingUploadTicket(recordingId, token)
    : null;
  if (!verified) {
    throw createError({
      statusCode: 401,
      message: "Invalid or expired upload ticket",
    });
  }
  const [recording] = await getDb()
    .select({ status: schema.recordings.status })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, verified.ownerEmail),
      ),
    );
  if (recording?.status !== "uploading") {
    throw createError({
      statusCode: 409,
      message:
        "This upload is finished or cancelled. Call create-recording-upload to start a new one.",
    });
  }
  return {
    recordingId,
    ownerEmail: verified.ownerEmail,
    ...(verified.ticket.orgId ? { orgId: verified.ticket.orgId } : {}),
  };
}
