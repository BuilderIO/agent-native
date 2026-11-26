import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import {
  CAPTURE_HOST_LEASE_MS,
  CAPTURE_STARTUP_BUDGET_MS,
  MAX_CAPTURE_MARKERS,
  assertCaptureTransition,
  isCaptureTerminal,
  type CaptureOutcome,
} from "../../shared/motion-capture.js";
import { getDb, schema } from "../db/index.js";

const hosts = schema.captureHosts;
const sessions = schema.captureSessions;
const markers = schema.captureMarkers;
const isoNow = () => new Date().toISOString();
const CLOCK_SKEW_MS = 5_000;
const earliestClipAt = (session: { createdAt: string }) =>
  new Date(Date.parse(session.createdAt) - CLOCK_SKEW_MS).toISOString();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function firstRow<T>(rows: T[]): T | undefined {
  return rows.length > 0 ? rows[0] : undefined;
}

export const CAPTURE_RECOVERY_GRACE_MS = 15_000;
const EXPIRED_HOST_SWEEP_LIMIT = 200;
export const CAPTURE_OUTCOME_UNCONFIRMED_ERROR =
  "Recorder lease expired after its bounded capture window; recorder outcome is unconfirmed, not stopped.";
export const CAPTURE_DISARMED_BEFORE_START_ERROR =
  "Recorder was disarmed before this take started; nothing was recorded.";

function unconfirmedOutcomeError(pendingOutcome: string | null) {
  return pendingOutcome
    ? `Recorder lease expired while its ${pendingOutcome} report was still being retried; recorder outcome is unconfirmed, not stopped.`
    : CAPTURE_OUTCOME_UNCONFIRMED_ERROR;
}

export function captureOwner(): string {
  const email = getRequestUserEmail()?.trim().toLowerCase();
  if (!email) throw new Error("Sign in to control a Clips recorder.");
  return email;
}

async function requireHost(id: string, secret?: string) {
  const host = firstRow(
    await getDb()
      .select()
      .from(hosts)
      .where(and(eq(hosts.id, id), eq(hosts.ownerEmail, captureOwner())))
      .limit(1),
  );
  if (!host) throw new Error("Capture host not found.");
  if (
    secret !== undefined &&
    !timingSafeEqual(
      Buffer.from(host.secretHash, "hex"),
      Buffer.from(hash(secret), "hex"),
    )
  ) {
    throw new Error("Capture host credential does not match.");
  }
  return host;
}

function assertMatchingCaptureRequest(
  existing: typeof sessions.$inferSelect,
  args: {
    hostId: string;
    captureMode: "normal" | "motion";
    maxDurationMs: number;
  },
) {
  if (
    existing.hostId !== args.hostId ||
    existing.captureMode !== args.captureMode ||
    existing.maxDurationMs !== args.maxDurationMs
  ) {
    throw new Error(
      "Request ID already belongs to a different capture request.",
    );
  }
  return existing;
}

async function findCaptureRequest(ownerEmail: string, requestId: string) {
  const existing = firstRow(
    await getDb()
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.ownerEmail, ownerEmail),
          eq(sessions.requestId, requestId),
        ),
      )
      .limit(1),
  );
  return existing ?? null;
}

function captureRecoveryDeadlineMs(session: typeof sessions.$inferSelect) {
  const createdAtMs = Date.parse(session.createdAt);
  if (!Number.isFinite(createdAtMs)) return null;
  return (
    createdAtMs +
    CAPTURE_STARTUP_BUDGET_MS +
    session.maxDurationMs +
    CAPTURE_RECOVERY_GRACE_MS
  );
}

async function reconcileExpiredActiveHost(
  candidate: typeof hosts.$inferSelect,
  nowMs = Date.now(),
  onlySessionId?: string,
) {
  if (
    !candidate.activeSessionId ||
    (onlySessionId !== undefined &&
      candidate.activeSessionId !== onlySessionId) ||
    candidate.state !== "armed" ||
    Date.parse(candidate.expiresAt) > nowMs
  ) {
    return { host: candidate, session: null, reconciled: false as const };
  }

  const ownerEmail = captureOwner();
  return getDb().transaction(async (db) => {
    const host = firstRow(
      await db
        .select()
        .from(hosts)
        .where(
          and(eq(hosts.id, candidate.id), eq(hosts.ownerEmail, ownerEmail)),
        )
        .limit(1)
        .for("update"),
    );
    if (
      !host ||
      !host.activeSessionId ||
      (onlySessionId !== undefined && host.activeSessionId !== onlySessionId) ||
      host.state !== "armed" ||
      Date.parse(host.expiresAt) > nowMs
    ) {
      return {
        host: host ?? candidate,
        session: null,
        reconciled: false as const,
      };
    }

    const session = firstRow(
      await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.id, host.activeSessionId),
            eq(sessions.ownerEmail, ownerEmail),
          ),
        )
        .limit(1)
        .for("update"),
    );
    if (!session) {
      throw new Error("Capture host references a missing session.");
    }
    if (isCaptureTerminal(session.state)) {
      return { host, session, reconciled: false as const };
    }

    const recoveryDeadlineMs = captureRecoveryDeadlineMs(session);
    if (recoveryDeadlineMs === null || nowMs <= recoveryDeadlineMs) {
      return { host, session, reconciled: false as const };
    }

    const now = new Date(nowMs).toISOString();
    const failed = firstRow(
      await db
        .update(sessions)
        .set({
          state: "failed",
          error: unconfirmedOutcomeError(session.pendingOutcome),
          updatedAt: now,
        })
        .where(
          and(
            eq(sessions.id, session.id),
            eq(sessions.ownerEmail, ownerEmail),
            eq(sessions.state, session.state),
          ),
        )
        .returning(),
    );
    if (!failed) {
      throw new Error(
        "Capture state changed while reconciling an expired recorder.",
      );
    }
    const released = firstRow(
      await db
        .update(hosts)
        .set({ state: "released", activeSessionId: null, expiresAt: now })
        .where(
          and(
            eq(hosts.id, host.id),
            eq(hosts.ownerEmail, ownerEmail),
            eq(hosts.activeSessionId, session.id),
          ),
        )
        .returning(),
    );
    if (!released) {
      throw new Error(
        "Capture host changed while reconciling its expired recorder.",
      );
    }
    return { host: released, session: failed, reconciled: true as const };
  });
}

export async function requireCaptureSession(id: string) {
  const session = firstRow(
    await getDb()
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.ownerEmail, captureOwner())))
      .limit(1),
  );
  if (!session) throw new Error("Capture session not found.");
  return session;
}

export async function listCaptureHosts() {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const expired = await getDb()
    .select()
    .from(hosts)
    .where(
      and(
        eq(hosts.ownerEmail, captureOwner()),
        eq(hosts.state, "armed"),
        lte(hosts.expiresAt, now),
        isNotNull(hosts.activeSessionId),
      ),
    )
    .orderBy(desc(hosts.createdAt), desc(hosts.id))
    .limit(EXPIRED_HOST_SWEEP_LIMIT);
  for (const row of expired) await reconcileExpiredActiveHost(row, nowMs);
  const rows = await getDb()
    .select()
    .from(hosts)
    .where(
      and(
        eq(hosts.ownerEmail, captureOwner()),
        eq(hosts.state, "armed"),
        or(
          gt(hosts.expiresAt, new Date(nowMs).toISOString()),
          isNotNull(hosts.activeSessionId),
        ),
      ),
    )
    .orderBy(desc(hosts.createdAt), desc(hosts.id))
    .limit(50);
  const reconciled = [];
  for (const row of rows) {
    const { host } = await reconcileExpiredActiveHost(row, nowMs);
    if (host.state === "armed") reconciled.push(host);
  }
  return reconciled.map(
    ({ secretHash: _secret, ownerEmail: _owner, ...host }) => ({
      ...host,
      connected: host.state === "armed" && Date.parse(host.expiresAt) > nowMs,
      requestedFrameRates: [24, 60],
      achievedFrameRate: null,
    }),
  );
}

export async function registerCaptureHost(args: {
  kind: string;
  label: string;
  surface: string;
}) {
  const secret = randomBytes(32).toString("hex");
  const id = randomUUID();
  await getDb()
    .insert(hosts)
    .values({
      id,
      ownerEmail: captureOwner(),
      secretHash: hash(secret),
      ...args,
      state: "armed",
      expiresAt: new Date(Date.now() + CAPTURE_HOST_LEASE_MS).toISOString(),
      createdAt: isoNow(),
    });
  return { id, secret, leaseMs: CAPTURE_HOST_LEASE_MS };
}

export async function startCapture(args: {
  hostId: string;
  requestId: string;
  captureMode: "normal" | "motion";
  maxDurationMs: number;
}) {
  const ownerEmail = captureOwner();
  try {
    return await getDb().transaction(async (db) => {
      const existing = firstRow(
        await db
          .select()
          .from(sessions)
          .where(
            and(
              eq(sessions.ownerEmail, ownerEmail),
              eq(sessions.requestId, args.requestId),
            ),
          )
          .limit(1),
      );
      if (existing) return assertMatchingCaptureRequest(existing, args);

      const host = firstRow(
        await db
          .select()
          .from(hosts)
          .where(
            and(eq(hosts.id, args.hostId), eq(hosts.ownerEmail, ownerEmail)),
          )
          .limit(1)
          .for("update"),
      );
      if (!host) throw new Error("Capture host not found.");
      if (host.state !== "armed" || Date.parse(host.expiresAt) <= Date.now())
        throw new Error(
          "Recorder is not connected and armed. Open Clips and enable agent capture for the chosen surface.",
        );
      const id = randomUUID();
      const claimed = await db
        .update(hosts)
        .set({ activeSessionId: id })
        .where(
          and(
            eq(hosts.id, host.id),
            eq(hosts.ownerEmail, ownerEmail),
            eq(hosts.state, "armed"),
            eq(hosts.expiresAt, host.expiresAt),
            isNull(hosts.activeSessionId),
          ),
        )
        .returning({ id: hosts.id });
      if (!claimed.length)
        throw new Error(
          "This recorder already owns a capture. Inspect or stop that session first.",
        );
      const now = isoNow();
      const session = firstRow(
        await db
          .insert(sessions)
          .values({
            id,
            ownerEmail,
            ...args,
            state: "queued",
            createdAt: now,
            updatedAt: now,
          })
          .returning(),
      );
      if (!session) throw new Error("Capture session was not created.");
      return session;
    });
  } catch (error) {
    const concurrent = await findCaptureRequest(ownerEmail, args.requestId);
    if (concurrent) return assertMatchingCaptureRequest(concurrent, args);
    throw error;
  }
}

export async function getCaptureSession(id: string) {
  let session = await requireCaptureSession(id);
  let host = await requireHost(session.hostId);
  const reconciliation = await reconcileExpiredActiveHost(
    host,
    Date.now(),
    session.id,
  );
  if (reconciliation.reconciled) {
    host = reconciliation.host;
    session = await requireCaptureSession(id);
  }
  const entries = await getDb()
    .select()
    .from(markers)
    .where(eq(markers.sessionId, id))
    .orderBy(asc(markers.requestedAt), asc(markers.id))
    .limit(MAX_CAPTURE_MARKERS);
  let mediaStatus: string | null = null;
  if (session.recordingId) {
    const recording = firstRow(
      await getDb()
        .select({ status: schema.recordings.status })
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.id, session.recordingId),
            eq(schema.recordings.ownerEmail, captureOwner()),
          ),
        )
        .limit(1),
    );
    mediaStatus = recording?.status ?? null;
  }
  return {
    ...session,
    recorderConnected:
      host.state === "armed" && Date.parse(host.expiresAt) > Date.now(),
    mediaStatus,
    mediaReady: mediaStatus === "ready",
    markers: entries,
    timingNote:
      "Marker mediaTimeMs is the recorder receipt time. The request lies within [mediaTimeMs - uncertaintyMs, mediaTimeMs + uncertaintyMs]; this is intent/endpoint timing, never exact input-to-paint timing.",
  };
}

export async function stopCapture(id: string) {
  const ownerEmail = captureOwner();
  const changed = await getDb()
    .update(sessions)
    .set({ state: "stop-requested", updatedAt: isoNow() })
    .where(
      and(
        eq(sessions.id, id),
        eq(sessions.ownerEmail, ownerEmail),
        inArray(sessions.state, [
          "queued",
          "starting",
          "beginning",
          "recording",
        ]),
      ),
    )
    .returning({ id: sessions.id });
  if (!changed.length) await requireCaptureSession(id);
  return getCaptureSession(id);
}

export async function addCaptureMarker(args: {
  sessionId: string;
  requestId: string;
  label: string;
  kind: string;
}) {
  const ownerEmail = captureOwner();
  return getDb().transaction(async (db) => {
    const session = firstRow(
      await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.id, args.sessionId),
            eq(sessions.ownerEmail, ownerEmail),
          ),
        )
        .limit(1)
        .for("update"),
    );
    if (!session) throw new Error("Capture session not found.");

    const id = hash(`${session.id}:${args.requestId}`);
    const existing = firstRow(
      await db.select().from(markers).where(eq(markers.id, id)).limit(1),
    );
    if (existing) {
      if (existing.label !== args.label || existing.kind !== args.kind)
        throw new Error(
          "Marker request ID already used with different content.",
        );
      return existing;
    }
    if (session.state !== "recording")
      throw new Error(
        session.state === "queued" ||
          session.state === "starting" ||
          session.state === "beginning"
          ? "Wait for recording READY before adding markers."
          : `Markers can only be added while the capture is recording; this one is ${session.state}.`,
      );
    const count = firstRow(
      await db
        .select({ total: sql<number>`count(*)` })
        .from(markers)
        .where(eq(markers.sessionId, session.id)),
    );
    if (Number(count?.total ?? 0) >= MAX_CAPTURE_MARKERS)
      throw new Error("Capture marker limit reached.");
    const marker = firstRow(
      await db
        .insert(markers)
        .values({
          id,
          sessionId: session.id,
          label: args.label,
          kind: args.kind,
          requestedAt: isoNow(),
        })
        .onConflictDoNothing()
        .returning(),
    );
    if (marker) return marker;
    const concurrent = firstRow(
      await db.select().from(markers).where(eq(markers.id, id)).limit(1),
    );
    if (
      !concurrent ||
      concurrent.label !== args.label ||
      concurrent.kind !== args.kind
    )
      throw new Error("Concurrent marker request conflicted.");
    return concurrent;
  });
}

export async function pollCaptureHost(
  id: string,
  secret: string,
  pending?: { sessionId: string; outcome: CaptureOutcome } | undefined,
) {
  const ownerEmail = captureOwner();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let host = await requireHost(id, secret);
    const reconciliation = await reconcileExpiredActiveHost(host);
    if (reconciliation.reconciled) {
      return {
        session: reconciliation.session,
        markers: [],
        serverNowMs: Date.now(),
      };
    }
    host = reconciliation.host;
    if (host.state !== "armed") {
      throw new Error("Recorder was released and must be armed again.");
    }
    const renewed = await getDb()
      .update(hosts)
      .set({
        expiresAt: new Date(Date.now() + CAPTURE_HOST_LEASE_MS).toISOString(),
      })
      .where(
        and(
          eq(hosts.id, id),
          eq(hosts.ownerEmail, ownerEmail),
          eq(hosts.state, "armed"),
          eq(hosts.expiresAt, host.expiresAt),
          host.activeSessionId
            ? eq(hosts.activeSessionId, host.activeSessionId)
            : isNull(hosts.activeSessionId),
        ),
      )
      .returning();
    const renewedHost = firstRow(renewed);
    if (!renewedHost) continue;
    host = renewedHost;
    if (!host.activeSessionId)
      return { session: null, markers: [], serverNowMs: Date.now() };
    let session = await requireCaptureSession(host.activeSessionId);
    if (
      pending &&
      pending.sessionId === session.id &&
      !isCaptureTerminal(session.state) &&
      session.pendingOutcome !== pending.outcome
    ) {
      session =
        firstRow(
          await getDb()
            .update(sessions)
            .set({ pendingOutcome: pending.outcome })
            .where(
              and(
                eq(sessions.id, session.id),
                eq(sessions.ownerEmail, ownerEmail),
                eq(sessions.state, session.state),
              ),
            )
            .returning(),
        ) ?? session;
    }
    const pendingMarkers = await getDb()
      .select()
      .from(markers)
      .where(
        and(eq(markers.sessionId, session.id), isNull(markers.mediaTimeMs)),
      )
      .orderBy(asc(markers.requestedAt))
      .limit(MAX_CAPTURE_MARKERS);
    return { session, markers: pendingMarkers, serverNowMs: Date.now() };
  }
  throw new Error("Recorder host changed concurrently; poll again.");
}

type CaptureWriter = Pick<ReturnType<typeof getDb>, "update">;

async function trashDiscardedRecording(
  db: CaptureWriter,
  session: typeof sessions.$inferSelect,
  recordingId: string,
) {
  const now = isoNow();
  await db
    .update(schema.recordings)
    .set({ trashedAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        eq(schema.recordings.ownerEmail, captureOwner()),
        gte(schema.recordings.createdAt, earliestClipAt(session)),
        ne(schema.recordings.status, "ready"),
        isNull(schema.recordings.trashedAt),
      ),
    );
}

async function clearActiveSession(
  db: CaptureWriter,
  hostId: string,
  sessionId: string,
) {
  await db
    .update(hosts)
    .set({ activeSessionId: null })
    .where(and(eq(hosts.id, hostId), eq(hosts.activeSessionId, sessionId)));
}

export async function reportCaptureHost(args: {
  hostId: string;
  secret: string;
  sessionId: string;
  state: string;
  recordingId?: string | undefined;
  startedAtMs?: number | undefined;
  startUncertaintyMs?: number | undefined;
  observedFrameRate?: number | undefined;
  error?: string | undefined;
}) {
  const host = await requireHost(args.hostId, args.secret);
  const session = await requireCaptureSession(args.sessionId);
  if (session.hostId !== host.id)
    throw new Error("Session belongs to a different recorder.");
  if (isCaptureTerminal(session.state)) {
    if (host.activeSessionId === session.id)
      await clearActiveSession(getDb(), host.id, session.id);
    return session;
  }
  if (host.activeSessionId !== session.id)
    throw new Error("Recorder no longer owns this session.");
  const terminal = isCaptureTerminal(args.state);
  if (
    (args.state === "starting" ||
      args.state === "beginning" ||
      args.state === "recording") &&
    session.state === "stop-requested"
  )
    return session;
  if (
    args.state === "beginning" &&
    session.state !== "starting" &&
    session.state !== "beginning"
  )
    return session;
  assertCaptureTransition(session.state, args.state);
  if (
    args.state === "recording" &&
    (!args.recordingId ||
      args.startedAtMs === undefined ||
      args.startUncertaintyMs === undefined)
  )
    throw new Error(
      "Recording READY requires an actual recording and capture clock.",
    );
  if (args.recordingId && !terminal) {
    const recording = firstRow(
      await getDb()
        .select({ createdAt: schema.recordings.createdAt })
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.id, args.recordingId),
            eq(schema.recordings.ownerEmail, captureOwner()),
          ),
        )
        .limit(1),
    );
    if (!recording)
      throw new Error("Recording is not owned by this capture user.");
    if (recording.createdAt < earliestClipAt(session))
      throw new Error("Recording was made before this capture.");
    if (session.recordingId && session.recordingId !== args.recordingId)
      throw new Error("Capture recording identity cannot change.");
  }
  const patch = terminal
    ? { state: args.state, error: args.error ?? null, pendingOutcome: null }
    : {
        state: args.state,
        recordingId: args.recordingId,
        startedAtMs: args.startedAtMs,
        startUncertaintyMs: args.startUncertaintyMs,
        observedFrameRate: args.observedFrameRate,
        error: args.error,
      };
  const updated = await getDb().transaction(async (db) => {
    if (terminal)
      await db
        .select({ id: hosts.id })
        .from(hosts)
        .where(eq(hosts.id, host.id))
        .limit(1)
        .for("update");
    const row = firstRow(
      await db
        .update(sessions)
        .set({ ...patch, updatedAt: isoNow() })
        .where(
          and(eq(sessions.id, session.id), eq(sessions.state, session.state)),
        )
        .returning(),
    );
    if (!row) return null;
    if (
      args.state === "recording" &&
      session.state !== "recording" &&
      args.recordingId
    )
      await db
        .update(schema.recordings)
        .set({ madeBy: "agent", madeByAgent: null, updatedAt: isoNow() })
        .where(
          and(
            eq(schema.recordings.id, args.recordingId),
            eq(schema.recordings.ownerEmail, captureOwner()),
          ),
        );
    if (terminal) {
      if (
        args.state === "cancelled" &&
        args.recordingId &&
        session.startedAtMs === null
      )
        await trashDiscardedRecording(db, session, args.recordingId);
      await clearActiveSession(db, host.id, session.id);
    }
    return row;
  });
  if (!updated) {
    const current = await requireCaptureSession(session.id);
    if (args.state === "beginning" || isCaptureTerminal(current.state))
      return current;
    throw new Error(
      "Capture state changed concurrently; poll before reporting again.",
    );
  }
  return updated;
}

export async function acknowledgeCaptureMarker(args: {
  hostId: string;
  secret: string;
  sessionId: string;
  markerId: string;
  mediaTimeMs: number;
  uncertaintyMs: number;
}) {
  const host = await requireHost(args.hostId, args.secret);
  const session = await requireCaptureSession(args.sessionId);
  if (session.hostId !== host.id || host.activeSessionId !== session.id)
    throw new Error("Recorder does not own marker session.");
  const result = await getDb()
    .update(markers)
    .set({ mediaTimeMs: args.mediaTimeMs, uncertaintyMs: args.uncertaintyMs })
    .where(
      and(
        eq(markers.id, args.markerId),
        eq(markers.sessionId, session.id),
        isNull(markers.mediaTimeMs),
      ),
    )
    .returning();
  return { acknowledged: result.length === 1 };
}

export async function releaseCaptureHost(id: string, secret: string) {
  const ownerEmail = captureOwner();
  return getDb().transaction(async (db) => {
    const host = firstRow(
      await db
        .select()
        .from(hosts)
        .where(and(eq(hosts.id, id), eq(hosts.ownerEmail, ownerEmail)))
        .limit(1)
        .for("update"),
    );
    if (!host) throw new Error("Capture host not found.");
    if (
      !timingSafeEqual(
        Buffer.from(host.secretHash, "hex"),
        Buffer.from(hash(secret), "hex"),
      )
    ) {
      throw new Error("Capture host credential does not match.");
    }
    if (host.activeSessionId) {
      const active = firstRow(
        await db
          .select()
          .from(sessions)
          .where(
            and(
              eq(sessions.id, host.activeSessionId),
              eq(sessions.ownerEmail, ownerEmail),
            ),
          )
          .limit(1)
          .for("update"),
      );
      if (active?.state === "queued") {
        await db
          .update(sessions)
          .set({
            state: "cancelled",
            error: CAPTURE_DISARMED_BEFORE_START_ERROR,
            updatedAt: isoNow(),
          })
          .where(and(eq(sessions.id, active.id), eq(sessions.state, "queued")));
      } else if (active && !isCaptureTerminal(active.state)) {
        throw new Error(
          "Stop the active capture before releasing its recorder.",
        );
      }
    }
    if (host.state === "released") return { released: true as const };
    const released = await db
      .update(hosts)
      .set({ state: "released", activeSessionId: null, expiresAt: isoNow() })
      .where(
        and(
          eq(hosts.id, id),
          eq(hosts.ownerEmail, ownerEmail),
          eq(hosts.state, "armed"),
          eq(hosts.expiresAt, host.expiresAt),
          host.activeSessionId
            ? eq(hosts.activeSessionId, host.activeSessionId)
            : isNull(hosts.activeSessionId),
        ),
      )
      .returning({ id: hosts.id });
    if (!released.length)
      throw new Error("Capture host changed concurrently; release again.");
    return { released: true as const };
  });
}
