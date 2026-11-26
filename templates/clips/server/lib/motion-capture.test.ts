import { createRequire } from "node:module";
const { PGlite } = createRequire(import.meta.resolve("@agent-native/core/db"))(
  "@electric-sql/pglite",
);
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, afterAll, expect, it, vi } from "vitest";

import { CAPTURE_STARTUP_BUDGET_MS } from "../../shared/motion-capture.js";
import * as schema from "../db/schema.js";
import {
  captureSessionPendingOutcomeMigration,
  captureTablesMigration,
} from "./capture-tables-schema.js";

let owner = "owner@example.test";
let database: ReturnType<typeof drizzle>;
vi.mock("../db/index.js", async () => ({
  getDb: () => database,
  schema: await import("../db/schema.js"),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => owner,
}));
import {
  CAPTURE_DISARMED_BEFORE_START_ERROR,
  CAPTURE_OUTCOME_UNCONFIRMED_ERROR,
  CAPTURE_RECOVERY_GRACE_MS,
  getCaptureSession,
  listCaptureHosts,
  pollCaptureHost,
  registerCaptureHost,
  releaseCaptureHost,
  reportCaptureHost,
  startCapture,
  stopCapture,
} from "./motion-capture.js";
const client = new PGlite();
beforeAll(async () => {
  await client.exec(captureTablesMigration);
  await client.exec(captureSessionPendingOutcomeMigration);
  await client.exec(
    "CREATE TABLE recordings (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'uploading', made_by TEXT, made_by_agent TEXT, created_at TEXT NOT NULL, trashed_at TEXT, updated_at TEXT NOT NULL)",
  );
  database = drizzle(client, { schema });
});
afterAll(async () => {
  await client.close();
});

it("deduplicates start and rejects a mismatched retry", async () => {
  const host = await registerCaptureHost({
    kind: "desktop",
    label: "test",
    surface: "display",
  });
  const args = {
    hostId: host.id,
    requestId: "same",
    captureMode: "motion" as const,
    maxDurationMs: 1000,
  };
  const first = await startCapture(args);
  expect((await startCapture(args)).id).toBe(first.id);
  await expect(startCapture({ ...args, maxDurationMs: 2000 })).rejects.toThrow(
    "different",
  );
  await expect(startCapture({ ...args, requestId: "other" })).rejects.toThrow(
    "already owns",
  );
});

it("does not allow another owner to inspect or stop the session", async () => {
  const host = await registerCaptureHost({
    kind: "desktop",
    label: "private",
    surface: "display",
  });
  const session = await startCapture({
    hostId: host.id,
    requestId: "private",
    captureMode: "normal",
    maxDurationMs: 1000,
  });
  owner = "other@example.test";
  try {
    await expect(getCaptureSession(session.id)).rejects.toThrow("not found");
    await expect(stopCapture(session.id)).rejects.toThrow("not found");
  } finally {
    owner = "owner@example.test";
  }
});

it("preserves a stop that races the starting acknowledgement and releases on cancellation", async () => {
  const host = await registerCaptureHost({
    kind: "desktop",
    label: "race",
    surface: "display",
  });
  const session = await startCapture({
    hostId: host.id,
    requestId: "race",
    captureMode: "normal",
    maxDurationMs: 1000,
  });
  await stopCapture(session.id);
  const auth = { hostId: host.id, secret: host.secret, sessionId: session.id };
  expect((await reportCaptureHost({ ...auth, state: "starting" })).state).toBe(
    "stop-requested",
  );
  await reportCaptureHost({ ...auth, state: "complete" });
  await reportCaptureHost({ ...auth, state: "complete" });
  expect((await releaseCaptureHost(host.id, host.secret)).released).toBe(true);
  expect((await getCaptureSession(session.id)).recorderConnected).toBe(false);
});

it("preserves stop when the recorder transition to recording wins first", async () => {
  const host = await registerCaptureHost({
    kind: "desktop",
    label: "stop-after-ready",
    surface: "display",
  });
  const session = await startCapture({
    hostId: host.id,
    requestId: "stop-after-ready",
    captureMode: "motion",
    maxDurationMs: 10_000,
  });
  await database
    .update(schema.captureSessions)
    .set({ state: "recording" })
    .where(eq(schema.captureSessions.id, session.id));

  const stopped = await stopCapture(session.id);

  expect(stopped.state).toBe("stop-requested");
});

it("uses the unique request fence for concurrent starts without leaking a losing host claim", async () => {
  const firstHost = await registerCaptureHost({
    kind: "desktop",
    label: "concurrent-a",
    surface: "display-a",
  });
  const secondHost = await registerCaptureHost({
    kind: "desktop",
    label: "concurrent-b",
    surface: "display-b",
  });
  const base = {
    requestId: "concurrent-request",
    captureMode: "motion" as const,
    maxDurationMs: 10_000,
  };

  const results = await Promise.allSettled([
    startCapture({ ...base, hostId: firstHost.id }),
    startCapture({ ...base, hostId: secondHost.id }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  const winnerHostIds = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value.hostId] : [],
  );
  const losingHostId = winnerHostIds.includes(firstHost.id)
    ? secondHost.id
    : firstHost.id;
  const losingHosts = await database
    .select()
    .from(schema.captureHosts)
    .where(eq(schema.captureHosts.id, losingHostId));
  expect(losingHosts.map((row) => row.activeSessionId)).toEqual([null]);

  const exactHost = await registerCaptureHost({
    kind: "desktop",
    label: "concurrent-exact",
    surface: "display-exact",
  });
  const exact = {
    ...base,
    hostId: exactHost.id,
    requestId: "concurrent-exact",
  };
  const [sameA, sameB] = await Promise.all([
    startCapture(exact),
    startCapture(exact),
  ]);
  expect(sameA.id).toBe(sameB.id);
});

it("serializes a start claim against releasing the same armed host", async () => {
  const host = await registerCaptureHost({
    kind: "desktop",
    label: "start-release-race",
    surface: "display",
  });
  const requestId = `start-release-race-${host.id}`;

  const [startResult, releaseResult] = await Promise.allSettled([
    startCapture({
      hostId: host.id,
      requestId,
      captureMode: "motion",
      maxDurationMs: 10_000,
    }),
    releaseCaptureHost(host.id, host.secret),
  ]);

  const startedId =
    startResult.status === "fulfilled" ? startResult.value.id : null;
  const storedHosts = await database
    .select()
    .from(schema.captureHosts)
    .where(eq(schema.captureHosts.id, host.id));
  const storedSessions = await database
    .select()
    .from(schema.captureSessions)
    .where(
      and(
        eq(schema.captureSessions.ownerEmail, owner),
        eq(schema.captureSessions.requestId, requestId),
      ),
    );
  expect(releaseResult.status).toBe("fulfilled");
  expect(storedHosts).toEqual([
    expect.objectContaining({ state: "released", activeSessionId: null }),
  ]);
  expect(
    storedSessions.map((row) => ({
      id: row.id,
      state: row.state,
      error: row.error,
    })),
  ).toEqual(
    startedId
      ? [
          {
            id: startedId,
            state: "cancelled",
            error: CAPTURE_DISARMED_BEFORE_START_ERROR,
          },
        ]
      : [],
  );
});

async function prepareExpiredCapture(suffix: string) {
  const host = await registerCaptureHost({
    kind: "desktop",
    label: `expired-${suffix}`,
    surface: "display",
  });
  const maxDurationMs = 1_000;
  const session = await startCapture({
    hostId: host.id,
    requestId: `expired-${suffix}`,
    captureMode: "motion",
    maxDurationMs,
  });
  const nowMs = Date.now();
  await database
    .update(schema.captureSessions)
    .set({
      state: "recording",
      createdAt: new Date(
        nowMs -
          CAPTURE_STARTUP_BUDGET_MS -
          maxDurationMs -
          CAPTURE_RECOVERY_GRACE_MS -
          1_000,
      ).toISOString(),
    })
    .where(eq(schema.captureSessions.id, session.id));
  await database
    .update(schema.captureHosts)
    .set({ expiresAt: new Date(nowMs - 1_000).toISOString() })
    .where(eq(schema.captureHosts.id, host.id));
  return { host, session };
}

it.each(["list", "get", "poll"] as const)(
  "reconciles an expired active host through %s without claiming it stopped",
  async (trigger) => {
    const { host, session } = await prepareExpiredCapture(trigger);
    const reconcile = {
      list: async () => {
        await listCaptureHosts();
        return null;
      },
      get: async () => {
        await getCaptureSession(session.id);
        return null;
      },
      poll: async () =>
        (await pollCaptureHost(host.id, host.secret)).session?.state ?? null,
    };
    expect(await reconcile[trigger]()).toBe(
      trigger === "poll" ? "failed" : null,
    );

    const [failed] = await database
      .select()
      .from(schema.captureSessions)
      .where(eq(schema.captureSessions.id, session.id));
    const [released] = await database
      .select()
      .from(schema.captureHosts)
      .where(eq(schema.captureHosts.id, host.id));
    expect(failed).toEqual(
      expect.objectContaining({
        state: "failed",
        error: CAPTURE_OUTCOME_UNCONFIRMED_ERROR,
      }),
    );
    expect(CAPTURE_OUTCOME_UNCONFIRMED_ERROR).toContain(
      "unconfirmed, not stopped",
    );
    expect(released).toEqual(
      expect.objectContaining({ state: "released", activeSessionId: null }),
    );

    const late = await reportCaptureHost({
      hostId: host.id,
      secret: host.secret,
      sessionId: session.id,
      state: "complete",
    });
    expect(late.state).toBe("failed");
    expect(late.error).toBe(CAPTURE_OUTCOME_UNCONFIRMED_ERROR);
    await expect(pollCaptureHost(host.id, host.secret)).rejects.toThrow(
      "armed again",
    );
  },
);

it("does not reconcile an expired lease before the capture deadline and recovery grace", async () => {
  const host = await registerCaptureHost({
    kind: "desktop",
    label: "within-grace",
    surface: "display",
  });
  const session = await startCapture({
    hostId: host.id,
    requestId: "within-grace",
    captureMode: "motion",
    maxDurationMs: 120_000,
  });
  await database
    .update(schema.captureHosts)
    .set({ expiresAt: new Date(Date.now() - 1_000).toISOString() })
    .where(eq(schema.captureHosts.id, host.id));

  const current = await getCaptureSession(session.id);
  expect(current.state).toBe("queued");
  expect(current.recorderConnected).toBe(false);
  const stillClaimed = await database
    .select()
    .from(schema.captureHosts)
    .where(
      and(
        eq(schema.captureHosts.id, host.id),
        eq(schema.captureHosts.activeSessionId, session.id),
      ),
    );
  expect(stillClaimed.map((row) => row.state)).toEqual(["armed"]);
});

it("decides recovery from server time even when the recorder clock runs slow", async () => {
  const host = await registerCaptureHost({
    kind: "desktop",
    label: "slow-clock",
    surface: "display",
  });
  const session = await startCapture({
    hostId: host.id,
    requestId: "slow-clock",
    captureMode: "motion",
    maxDurationMs: 5_000,
  });
  await database
    .update(schema.captureSessions)
    .set({ state: "recording", startedAtMs: Date.now() - 3_600_000 })
    .where(eq(schema.captureSessions.id, session.id));
  await database
    .update(schema.captureHosts)
    .set({ expiresAt: new Date(Date.now() - 1_000).toISOString() })
    .where(eq(schema.captureHosts.id, host.id));

  const current = await getCaptureSession(session.id);

  expect(current.state).toBe("recording");
  expect(current.error).toBeNull();
});

it("returns only the requested session after its host moved on to another take", async () => {
  const host = await registerCaptureHost({
    kind: "desktop",
    label: "two-takes",
    surface: "display",
  });
  const auth = { hostId: host.id, secret: host.secret };
  const first = await startCapture({
    hostId: host.id,
    requestId: "take-a",
    captureMode: "motion",
    maxDurationMs: 1_000,
  });
  await stopCapture(first.id);
  await reportCaptureHost({ ...auth, sessionId: first.id, state: "complete" });
  const second = await startCapture({
    hostId: host.id,
    requestId: "take-b",
    captureMode: "motion",
    maxDurationMs: 1_000,
  });
  await database
    .update(schema.captureSessions)
    .set({
      state: "recording",
      createdAt: new Date(
        Date.now() -
          CAPTURE_STARTUP_BUDGET_MS -
          1_000 -
          CAPTURE_RECOVERY_GRACE_MS -
          1_000,
      ).toISOString(),
    })
    .where(eq(schema.captureSessions.id, second.id));
  await database
    .update(schema.captureHosts)
    .set({ expiresAt: new Date(Date.now() - 1_000).toISOString() })
    .where(eq(schema.captureHosts.id, host.id));

  const status = await getCaptureSession(first.id);

  expect(status.id).toBe(first.id);
  expect(status.state).toBe("complete");
  const untouched = await database
    .select()
    .from(schema.captureSessions)
    .where(eq(schema.captureSessions.id, second.id));
  expect(untouched.map((session) => session.state)).toEqual(["recording"]);
});

it("lists only armed recorders, newest first, however many were released before", async () => {
  owner = "busy-owner@example.test";
  try {
    for (let index = 0; index < 55; index += 1) {
      const old = await registerCaptureHost({
        kind: "desktop",
        label: `old-${index}`,
        surface: "display",
      });
      await releaseCaptureHost(old.id, old.secret);
    }
    const older = await registerCaptureHost({
      kind: "desktop",
      label: "older-armed",
      surface: "display",
    });
    await database
      .update(schema.captureHosts)
      .set({ createdAt: new Date(Date.now() - 60_000).toISOString() })
      .where(eq(schema.captureHosts.id, older.id));
    const newest = await registerCaptureHost({
      kind: "chrome-extension",
      label: "newest-armed",
      surface: "tab",
    });

    const listed = await listCaptureHosts();

    expect(listed.map((host) => host.id)).toEqual([newest.id, older.id]);
    expect(listed.every((host) => host.connected)).toBe(true);
  } finally {
    owner = "owner@example.test";
  }
});

async function startedTake(label: string, maxDurationMs = 10_000) {
  const host = await registerCaptureHost({
    kind: "desktop",
    label,
    surface: "display",
  });
  const session = await startCapture({
    hostId: host.id,
    requestId: label,
    captureMode: "motion",
    maxDurationMs,
  });
  const auth = { hostId: host.id, secret: host.secret, sessionId: session.id };
  await reportCaptureHost({ ...auth, state: "starting" });
  return { host, session, auth };
}

async function insertRecording(
  id: string,
  { status = "uploading", createdAt = new Date().toISOString() } = {},
) {
  await client.query(
    "INSERT INTO recordings (id, owner_email, status, made_by, created_at, updated_at) VALUES ($1, $2, $3, 'person', $4, $4)",
    [id, owner, status, createdAt],
  );
}

async function madeBy(id: string) {
  const result = await client.query(
    "SELECT made_by, made_by_agent FROM recordings WHERE id = $1",
    [id],
  );
  return result.rows[0] as {
    made_by: string | null;
    made_by_agent: string | null;
  };
}

async function trashedAt(id: string) {
  const result = await client.query(
    "SELECT trashed_at FROM recordings WHERE id = $1",
    [id],
  );
  const row = result.rows[0] as { trashed_at: string | null } | undefined;
  return row?.trashed_at ?? null;
}

it("accepts the begin gate only from starting with no stop requested", async () => {
  const { session, auth } = await startedTake("gate-open");
  expect((await reportCaptureHost({ ...auth, state: "beginning" })).state).toBe(
    "beginning",
  );
  expect((await reportCaptureHost({ ...auth, state: "beginning" })).state).toBe(
    "beginning",
  );
  await insertRecording("gate-open-recording");
  const ready = await reportCaptureHost({
    ...auth,
    state: "recording",
    recordingId: "gate-open-recording",
    startedAtMs: 100,
    startUncertaintyMs: 1,
  });
  expect(ready).toEqual(
    expect.objectContaining({ state: "recording", startedAtMs: 100 }),
  );
  expect((await reportCaptureHost({ ...auth, state: "beginning" })).state).toBe(
    "recording",
  );
  expect((await getCaptureSession(session.id)).state).toBe("recording");
});

it("refuses the begin gate after a stop and never lets a take skip it", async () => {
  const { session, auth } = await startedTake("gate-stopped");
  await insertRecording("gate-stopped-recording");
  await expect(
    reportCaptureHost({
      ...auth,
      state: "recording",
      recordingId: "gate-stopped-recording",
      startedAtMs: 100,
      startUncertaintyMs: 1,
    }),
  ).rejects.toThrow("Invalid capture transition: starting -> recording");
  await stopCapture(session.id);
  expect((await reportCaptureHost({ ...auth, state: "beginning" })).state).toBe(
    "stop-requested",
  );
  await reportCaptureHost({ ...auth, state: "cancelled", error: "stopped" });
  expect(await getCaptureSession(session.id)).toEqual(
    expect.objectContaining({ state: "cancelled", recordingId: null }),
  );
});

it("discards a take stopped between the gate and READY without surfacing its recording", async () => {
  const { host, session, auth } = await startedTake("gate-discard");
  await reportCaptureHost({ ...auth, state: "beginning" });
  const stopped = await stopCapture(session.id);
  expect(stopped.state).toBe("stop-requested");
  await insertRecording("gate-discard-recording");
  const late = await reportCaptureHost({
    ...auth,
    state: "recording",
    recordingId: "gate-discard-recording",
    startedAtMs: 100,
    startUncertaintyMs: 1,
  });
  expect(late).toEqual(
    expect.objectContaining({
      state: "stop-requested",
      recordingId: null,
      startedAtMs: null,
    }),
  );
  const cancelled = await reportCaptureHost({
    ...auth,
    state: "cancelled",
    recordingId: "gate-discard-recording",
    error: "Capture was stopped before the recorder was ready.",
  });
  expect(cancelled).toEqual(
    expect.objectContaining({ state: "cancelled", recordingId: null }),
  );
  expect(await trashedAt("gate-discard-recording")).not.toBeNull();
  expect((await stopCapture(session.id)).state).toBe("cancelled");
  expect((await releaseCaptureHost(host.id, host.secret)).released).toBe(true);
});

it("leaves a finished Clip alone when a recorder cancels with its ID", async () => {
  const { session, auth } = await startedTake("cancel-finished");
  await reportCaptureHost({ ...auth, state: "beginning" });
  await stopCapture(session.id);
  await insertRecording("cancel-finished-recording", { status: "ready" });
  await reportCaptureHost({
    ...auth,
    state: "cancelled",
    recordingId: "cancel-finished-recording",
    error: "stopped",
  });
  expect(await trashedAt("cancel-finished-recording")).toBeNull();
});

it("keeps a cancelled take open until its Clip is discarded", async () => {
  const { session, auth } = await startedTake("discard-fails");
  await reportCaptureHost({ ...auth, state: "beginning" });
  await stopCapture(session.id);
  await insertRecording("discard-fails-recording");
  const cancel = () =>
    reportCaptureHost({
      ...auth,
      state: "cancelled",
      recordingId: "discard-fails-recording",
      error: "stopped",
    });
  await client.exec(
    "ALTER TABLE recordings ADD CONSTRAINT keep_discard_fails CHECK (id <> 'discard-fails-recording' OR trashed_at IS NULL)",
  );
  await expect(cancel()).rejects.toThrow();
  expect((await getCaptureSession(session.id)).state).toBe("stop-requested");
  await client.exec(
    "ALTER TABLE recordings DROP CONSTRAINT keep_discard_fails",
  );
  expect((await cancel()).state).toBe("cancelled");
  expect(await trashedAt("discard-fails-recording")).not.toBeNull();
});

it("accepts a Clip dated just before its session by another server's clock", async () => {
  const { session, auth } = await startedTake("ready-skew");
  await reportCaptureHost({ ...auth, state: "beginning" });
  await insertRecording("skewed-recording", {
    createdAt: new Date(Date.parse(session.createdAt) - 2_000).toISOString(),
  });
  expect(
    (
      await reportCaptureHost({
        ...auth,
        state: "recording",
        recordingId: "skewed-recording",
        startedAtMs: 100,
        startUncertaintyMs: 1,
      })
    ).state,
  ).toBe("recording");
  await stopCapture(session.id);
  await reportCaptureHost({ ...auth, state: "cancelled", error: "stopped" });
});

it("refuses READY for a Clip made before the capture", async () => {
  const { session, auth } = await startedTake("ready-earlier");
  await reportCaptureHost({ ...auth, state: "beginning" });
  await insertRecording("earlier-recording", {
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  await expect(
    reportCaptureHost({
      ...auth,
      state: "recording",
      recordingId: "earlier-recording",
      startedAtMs: 100,
      startUncertaintyMs: 1,
    }),
  ).rejects.toThrow("Recording was made before this capture.");
  expect((await madeBy("earlier-recording")).made_by).toBe("person");
  expect((await getCaptureSession(session.id)).state).toBe("beginning");
  await stopCapture(session.id);
  await reportCaptureHost({ ...auth, state: "cancelled", error: "stopped" });
});

it("keeps a take stopped after READY and saves it as complete", async () => {
  const { session, auth } = await startedTake("ready-save");
  await reportCaptureHost({ ...auth, state: "beginning" });
  await insertRecording("ready-save-recording");
  await reportCaptureHost({
    ...auth,
    state: "recording",
    recordingId: "ready-save-recording",
    startedAtMs: 100,
    startUncertaintyMs: 1,
  });
  expect(await madeBy("ready-save-recording")).toEqual({
    made_by: "agent",
    made_by_agent: null,
  });
  await stopCapture(session.id);
  await stopCapture(session.id);
  const repeated = await reportCaptureHost({
    ...auth,
    state: "recording",
    recordingId: "ready-save-recording",
    startedAtMs: 100,
    startUncertaintyMs: 1,
  });
  expect(repeated).toEqual(
    expect.objectContaining({ state: "stop-requested", startedAtMs: 100 }),
  );
  await reportCaptureHost({ ...auth, state: "finalizing" });
  await reportCaptureHost({ ...auth, state: "complete" });
  expect(await getCaptureSession(session.id)).toEqual(
    expect.objectContaining({
      state: "complete",
      recordingId: "ready-save-recording",
    }),
  );
  expect(await trashedAt("ready-save-recording")).toBeNull();
});

it("shows an outcome the recorder has not delivered and clears it once delivered", async () => {
  const { host, session, auth } = await startedTake("pending-outcome");
  await reportCaptureHost({ ...auth, state: "beginning" });
  await insertRecording("pending-outcome-recording");
  await reportCaptureHost({
    ...auth,
    state: "recording",
    recordingId: "pending-outcome-recording",
    startedAtMs: 100,
    startUncertaintyMs: 1,
  });
  await reportCaptureHost({ ...auth, state: "finalizing" });
  const polled = await pollCaptureHost(host.id, host.secret, {
    sessionId: session.id,
    outcome: "complete",
  });
  expect(polled.session?.pendingOutcome).toBe("complete");
  expect((await getCaptureSession(session.id)).pendingOutcome).toBe("complete");
  await reportCaptureHost({ ...auth, state: "complete" });
  expect(await getCaptureSession(session.id)).toEqual(
    expect.objectContaining({ state: "complete", pendingOutcome: null }),
  );
});

it("names the undelivered outcome when the recorder lease expires", async () => {
  const { host, session, auth } = await startedTake("pending-expired", 1_000);
  await reportCaptureHost({ ...auth, state: "beginning" });
  await pollCaptureHost(host.id, host.secret, {
    sessionId: session.id,
    outcome: "failed",
  });
  await database
    .update(schema.captureSessions)
    .set({
      createdAt: new Date(
        Date.now() -
          CAPTURE_STARTUP_BUDGET_MS -
          1_000 -
          CAPTURE_RECOVERY_GRACE_MS -
          1_000,
      ).toISOString(),
    })
    .where(eq(schema.captureSessions.id, session.id));
  await database
    .update(schema.captureHosts)
    .set({ expiresAt: new Date(Date.now() - 1_000).toISOString() })
    .where(eq(schema.captureHosts.id, host.id));
  const status = await getCaptureSession(session.id);
  expect(status.state).toBe("failed");
  expect(status.error).toContain("failed report was still being retried");
});

it("release settles a queued take, lets a settled one go and refuses a live one", async () => {
  const queuedHost = await registerCaptureHost({
    kind: "desktop",
    label: "release-queued",
    surface: "display",
  });
  const queued = await startCapture({
    hostId: queuedHost.id,
    requestId: "release-queued",
    captureMode: "motion",
    maxDurationMs: 1_000,
  });
  expect(
    (await releaseCaptureHost(queuedHost.id, queuedHost.secret)).released,
  ).toBe(true);
  expect(await getCaptureSession(queued.id)).toEqual(
    expect.objectContaining({
      state: "cancelled",
      error: CAPTURE_DISARMED_BEFORE_START_ERROR,
    }),
  );

  const { host, auth } = await startedTake("release-live");
  await expect(releaseCaptureHost(host.id, host.secret)).rejects.toThrow(
    "Stop the active capture",
  );
  await reportCaptureHost({ ...auth, state: "cancelled", error: "disarmed" });
  expect((await releaseCaptureHost(host.id, host.secret)).released).toBe(true);
});

it("settles expired recorders before the 50-host limit so live ones still list", async () => {
  owner = "crowded-owner@example.test";
  try {
    for (let index = 0; index < 52; index += 1) {
      const lapsed = await registerCaptureHost({
        kind: "desktop",
        label: `lapsed-${index}`,
        surface: "display",
      });
      const take = await startCapture({
        hostId: lapsed.id,
        requestId: `lapsed-${index}`,
        captureMode: "motion",
        maxDurationMs: 1_000,
      });
      await database
        .update(schema.captureSessions)
        .set({
          state: "recording",
          createdAt: new Date(
            Date.now() -
              CAPTURE_STARTUP_BUDGET_MS -
              1_000 -
              CAPTURE_RECOVERY_GRACE_MS -
              1_000,
          ).toISOString(),
        })
        .where(eq(schema.captureSessions.id, take.id));
      await database
        .update(schema.captureHosts)
        .set({
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
          createdAt: new Date(Date.now() + 60_000 + index).toISOString(),
        })
        .where(eq(schema.captureHosts.id, lapsed.id));
    }
    const live = await registerCaptureHost({
      kind: "chrome-extension",
      label: "live",
      surface: "tab",
    });

    const listed = await listCaptureHosts();

    expect(listed.map((host) => host.id)).toEqual([live.id]);
    expect(listed.map((host) => host.connected)).toEqual([true]);
  } finally {
    owner = "owner@example.test";
  }
});
