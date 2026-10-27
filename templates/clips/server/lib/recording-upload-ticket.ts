import crypto from "node:crypto";

import { getDbExec } from "@agent-native/core/db";
import { getUserSetting } from "@agent-native/core/settings";
import { and, eq, inArray } from "drizzle-orm";
import { createError, getHeader, type H3Event } from "h3";

import { getDb, schema } from "../db/index.js";
import { ownerEmailMatches } from "./recordings.js";

const SETTING_KEY = "clips-recording-upload-ticket";
const TOKEN_PREFIX = "clipsup_";
// A backstop, not the main bound: the agent chunk route only accepts a ticket
// while its recording is "uploading", and the lease reaper fails an upload idle
// for an hour. Sized for the 2 GiB cap at ~0.8 Mbps so a slow but live upload
// is never cut off, since tickets are not renewed per chunk.
export const RECORDING_UPLOAD_TICKET_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PENDING_TICKETS = 20;
const MAX_CAS_ATTEMPTS = 8;
// How long a reservation whose recording row is still missing counts toward the
// cap: ample for create-recording, short enough that a deleted recording or a
// failed release does not hold a slot for the ticket's whole lifetime.
export const RESERVATION_GRACE_MS = 10 * 60 * 1000;
// The most tokens one recording's ticket keeps live when a start is repeated,
// counting the newest.
const MAX_TOKENS_PER_TICKET = 4;

interface UploadToken {
  tokenHash: string;
  expiresAt: number;
}

export interface RecordingUploadTicket extends Record<string, unknown> {
  recordingId: string;
  /** The newest token's hash; the ticket expires with it. */
  tokenHash: string;
  reservedAt: number;
  expiresAt: number;
  /** The creator's auth user id, which a hosted-storage reservation is held under. */
  authUserId?: string;
  /** Tokens an earlier answer to a repeated start returned, newest first. */
  earlierTokens?: UploadToken[];
}

interface RecordingUploadTickets extends Record<string, unknown> {
  tickets: Record<string, RecordingUploadTicket>;
}

export interface RecordingUploadTicketOwner {
  recordingId: string;
  ownerEmail: string;
  orgId: string;
  authUserId?: string;
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

function dropExpiredTickets(
  tickets: Record<string, RecordingUploadTicket>,
  now: number,
): Record<string, RecordingUploadTicket> {
  return Object.fromEntries(
    Object.entries(tickets).filter(
      ([, ticket]) =>
        Number.isFinite(ticket.expiresAt) && ticket.expiresAt >= now,
    ),
  );
}

/**
 * A ticket holds a slot while its recording is "uploading", or while it is a
 * fresh reservation whose recording is not created yet. Evicting either would
 * strand an upload mid-file.
 */
async function liveTickets(
  ownerEmail: string,
  tickets: Record<string, RecordingUploadTicket>,
): Promise<Record<string, RecordingUploadTicket>> {
  const unexpired = dropExpiredTickets(tickets, Date.now());
  const recordingIds = Object.keys(unexpired);
  if (recordingIds.length < MAX_PENDING_TICKETS) return unexpired;
  const recordings = await getDb()
    .select({ id: schema.recordings.id, status: schema.recordings.status })
    .from(schema.recordings)
    .where(
      and(
        inArray(schema.recordings.id, recordingIds),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );
  const statusById = new Map(
    recordings.map((recording) => [recording.id, recording.status]),
  );
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(unexpired).filter(([recordingId, ticket]) => {
      const status = statusById.get(recordingId);
      return status === undefined
        ? now - ticket.reservedAt < RESERVATION_GRACE_MS
        : status === "uploading";
    }),
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

function liveTokens(ticket: RecordingUploadTicket | undefined): UploadToken[] {
  if (!ticket) return [];
  const now = Date.now();
  // Parsed from stored JSON, so an earlier token can be anything.
  const earlier: unknown[] = Array.isArray(ticket.earlierTokens)
    ? ticket.earlierTokens
    : [];
  return [
    { tokenHash: ticket.tokenHash, expiresAt: ticket.expiresAt },
    ...earlier,
  ].filter((token): token is UploadToken => {
    const { tokenHash, expiresAt } = (token ?? {}) as Partial<UploadToken>;
    return (
      typeof tokenHash === "string" &&
      typeof expiresAt === "number" &&
      Number.isFinite(expiresAt) &&
      expiresAt >= now
    );
  });
}

/**
 * Reserve before creating the recording: the cap is enforced inside the same
 * compare-and-swap, so a refusal or a failed write leaves nothing behind. The
 * new token replaces the recording's earlier ones.
 */
export function createRecordingUploadTicket(
  ownerEmail: string,
  recordingId: string,
  authUserId?: string,
): Promise<RecordingUploadTicket & { token: string }> {
  return issueRecordingUploadTicket(ownerEmail, recordingId, authUserId, false);
}

/**
 * Another token for a recording's upload, for a repeated start. The earlier
 * tokens keep working, since overlapping repeats each hand one back, up to
 * `MAX_TOKENS_PER_TICKET` with the oldest retired first. The recording still
 * holds one slot.
 */
export function addRecordingUploadTicket(
  ownerEmail: string,
  recordingId: string,
  authUserId?: string,
): Promise<RecordingUploadTicket & { token: string }> {
  return issueRecordingUploadTicket(ownerEmail, recordingId, authUserId, true);
}

async function issueRecordingUploadTicket(
  ownerEmail: string,
  recordingId: string,
  authUserId: string | undefined,
  keepEarlier: boolean,
): Promise<RecordingUploadTicket & { token: string }> {
  const token = `${TOKEN_PREFIX}${encodeOwner(ownerEmail)}.${crypto.randomBytes(32).toString("base64url")}`;
  const issuedAt = Date.now();

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const { raw, collection } = await readTicketsRow(ownerEmail);
    const live = await liveTickets(ownerEmail, collection.tickets);
    const earlier = keepEarlier ? live[recordingId] : undefined;
    delete live[recordingId];
    const ticketAuthUserId =
      (typeof earlier?.authUserId === "string" ? earlier.authUserId : "") ||
      authUserId;
    const ticket: RecordingUploadTicket = {
      recordingId,
      tokenHash: tokenHash(token),
      reservedAt: earlier?.reservedAt ?? issuedAt,
      expiresAt: issuedAt + RECORDING_UPLOAD_TICKET_TTL_MS,
      ...(ticketAuthUserId ? { authUserId: ticketAuthUserId } : {}),
      ...(earlier
        ? {
            earlierTokens: liveTokens(earlier).slice(
              0,
              MAX_TOKENS_PER_TICKET - 1,
            ),
          }
        : {}),
    };
    if (Object.keys(live).length >= MAX_PENDING_TICKETS) {
      throw createError({
        statusCode: 429,
        message: `${MAX_PENDING_TICKETS} agent uploads are still in progress. Finish one before starting another; an abandoned upload frees its slot once it has been idle for an hour.`,
      });
    }
    const tickets = { ...live, [recordingId]: ticket };
    if (await compareAndSwapTickets(ownerEmail, raw, { tickets })) {
      return { ...ticket, token };
    }
  }
  throw new Error("Could not reserve a recording upload ticket");
}

/**
 * For a reservation whose recording was never created, while it is still the
 * one that token's start made: a later start for the same recording id
 * replaces it, and that start's ticket stays.
 */
export async function releaseRecordingUploadTicket(
  ownerEmail: string,
  recordingId: string,
  issuedTokenHash: string,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const { raw, collection } = await readTicketsRow(ownerEmail);
    if (collection.tickets[recordingId]?.tokenHash !== issuedTokenHash) return;
    const { [recordingId]: _released, ...tickets } = collection.tickets;
    if (await compareAndSwapTickets(ownerEmail, raw, { tickets })) return;
  }
  throw new Error("Could not release a recording upload ticket");
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
  const presented = tokenHash(token);
  if (
    !ticket ||
    !liveTokens(ticket).some((live) => hashesMatch(live.tokenHash, presented))
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
  return requireUploadTicketOwnerForToken(recordingId, readTicketToken(event));
}

/** The same check for a ticket that arrives some other way than the header. */
export async function requireUploadTicketOwnerForToken(
  recordingId: string,
  token: string | null,
): Promise<RecordingUploadTicketOwner> {
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
    .select({
      status: schema.recordings.status,
      organizationId: schema.recordings.organizationId,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, verified.ownerEmail),
      ),
    );
  if (recording?.status === "processing" || recording?.status === "ready") {
    throw createError({
      statusCode: 409,
      message:
        "This upload is already finished: its last chunk was accepted. Read the clip with get-recording-player-data instead of uploading it again.",
      data: { recordingId, status: recording.status },
    });
  }
  if (recording?.status !== "uploading") {
    throw createError({
      statusCode: 409,
      message:
        "This upload failed or was cancelled. Call create-recording-upload to start a new one.",
      data: { recordingId, status: recording?.status ?? null },
    });
  }
  return {
    recordingId,
    ownerEmail: verified.ownerEmail,
    orgId: recording.organizationId,
    ...(typeof verified.ticket.authUserId === "string"
      ? { authUserId: verified.ticket.authUserId }
      : {}),
  };
}
