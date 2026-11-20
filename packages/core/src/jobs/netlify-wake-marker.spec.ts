import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { AGENT_BACKGROUND_FUNCTION_NAME } from "../agent/durable-background.js";
import {
  emitSingleTemplateNetlifyRecurringJobsFunction,
  NETLIFY_RECURRING_JOBS_FUNCTION_NAME,
} from "../deploy/build.js";
import {
  __resetNetlifyActivityMarkForTests,
  decideIdleSweepAfter,
  IDLE_AFTER_ACTIVITY_MS,
  markNetlifyAppActivity,
  recordNetlifySweepOutcome,
  resolveIdleSweepMaxMs,
} from "./netlify-wake-marker.js";

const MINUTE = 60_000;
const T0 = Date.parse("2026-11-20T12:00:00.000Z");
const blobsContext = (uncached = true) =>
  Buffer.from(
    JSON.stringify({
      siteID: "site-1",
      token: "blobs-token",
      edgeURL: "https://edge.blobs.test",
      ...(uncached ? { uncachedEdgeURL: "https://uncached.blobs.test" } : {}),
    }),
  ).toString("base64");
const BLOBS_CONTEXT = blobsContext();
const markerPath = (key: string) =>
  `/site-1/site:agent-native-recurring-jobs/${key}`;

function fakeNetlify() {
  const blobs = new Map<string, string>();
  const handoffs: string[] = [];
  let blobFailures = 0;
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname.endsWith("blobs.test")) {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer blobs-token",
        );
        if (blobFailures > 0) {
          blobFailures -= 1;
          return new Response("unavailable", { status: 500 });
        }
        if (init?.method === "PUT") {
          blobs.set(url.pathname, String(init.body));
          return new Response(null, { status: 200 });
        }
        const value = blobs.get(url.pathname);
        return value === undefined
          ? new Response("", { status: 404 })
          : new Response(value, { status: 200 });
      }
      handoffs.push(url.pathname);
      return new Response(null, { status: 202 });
    },
  );
  return {
    blobs,
    handoffs,
    fetchMock,
    failBlobs: (times = Infinity) => {
      blobFailures = times;
    },
  };
}

const ENV_KEYS = [
  "NETLIFY",
  "NETLIFY_BLOBS_CONTEXT",
  "A2A_SECRET",
  "AGENT_NATIVE_IDLE_SWEEP_MAX_MINUTES",
  "AGENT_NATIVE_DISABLE_RECURRING_JOBS",
] as const;
let savedEnv: Record<string, string | undefined> = {};
let netlify: ReturnType<typeof fakeNetlify>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.NETLIFY_BLOBS_CONTEXT = BLOBS_CONTEXT;
  process.env.A2A_SECRET = "a2a-secret";
  netlify = fakeNetlify();
  vi.stubGlobal("fetch", netlify.fetchMock);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  __resetNetlifyActivityMarkForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("decideIdleSweepAfter", () => {
  const quiet = {
    now: T0,
    busy: false,
    lastActivityAt: T0 - IDLE_AFTER_ACTIVITY_MS,
    nextDueAt: null,
    maxIdleMs: 60 * MINUTE,
  };

  it("sleeps until the cap when nothing is scheduled", () => {
    expect(decideIdleSweepAfter(quiet)).toBe(T0 + 60 * MINUTE);
    expect(decideIdleSweepAfter({ ...quiet, lastActivityAt: null })).toBe(
      T0 + 60 * MINUTE,
    );
  });

  it("wakes for the next automation, never later than the cap", () => {
    const at = (nextDueAt: number) =>
      decideIdleSweepAfter({ ...quiet, nextDueAt });
    expect(at(T0 + 20 * MINUTE)).toBe(T0 + 20 * MINUTE);
    expect(at(T0 + 5 * 60 * MINUTE)).toBe(T0 + 60 * MINUTE);
    expect(at(T0 - MINUTE)).toBe(T0);
  });

  it("keeps the minute cadence while busy, recently visited, or turned off", () => {
    expect(decideIdleSweepAfter({ ...quiet, busy: true })).toBe(T0);
    expect(
      decideIdleSweepAfter({ ...quiet, lastActivityAt: T0 - 9 * MINUTE }),
    ).toBe(T0);
    expect(decideIdleSweepAfter({ ...quiet, maxIdleMs: 0 })).toBe(T0);
  });
});

describe("resolveIdleSweepMaxMs", () => {
  it.each([
    [undefined, 60 * MINUTE],
    ["15", 15 * MINUTE],
    ["0", 0],
    ["-3", 60 * MINUTE],
    ["soon", 60 * MINUTE],
    ["100000", 24 * 60 * MINUTE],
  ])("reads %s as %d ms", (raw, expected) => {
    expect(
      resolveIdleSweepMaxMs({ AGENT_NATIVE_IDLE_SWEEP_MAX_MINUTES: raw }),
    ).toBe(expected);
  });
});

describe("markNetlifyAppActivity", () => {
  it("writes at most once a minute per instance", async () => {
    await markNetlifyAppActivity(T0);
    expect(markNetlifyAppActivity(T0 + 30_000)).toBeNull();
    await markNetlifyAppActivity(T0 + MINUTE);

    const writes = netlify.fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "PUT",
    );
    expect(writes).toHaveLength(2);
    expect([...netlify.blobs.values()]).toEqual([
      JSON.stringify({ at: T0 + MINUTE }),
    ]);
  });

  it("retries a failed write twice before giving up on it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    netlify.failBlobs(2);

    await markNetlifyAppActivity(T0);

    expect([...netlify.blobs.values()]).toEqual([JSON.stringify({ at: T0 })]);
    expect(markNetlifyAppActivity(T0 + 1_000)).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("lets the next request retry after a failed write", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    netlify.failBlobs();

    await markNetlifyAppActivity(T0);
    expect(
      netlify.fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT"),
    ).toHaveLength(3);

    const retry = markNetlifyAppActivity(T0 + 1_000);
    expect(retry).not.toBeNull();
    await retry;
  });

  it("writes nothing outside Netlify's function runtime", () => {
    delete process.env.NETLIFY_BLOBS_CONTEXT;

    expect(markNetlifyAppActivity(T0)).toBeNull();
    expect(netlify.fetchMock).not.toHaveBeenCalled();
  });
});

describe("the Netlify scheduled function and the sweep", () => {
  let tmp: string;
  let handler: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "an-wake-marker-"));
    const internalDir = path.join(tmp, ".netlify", "functions-internal");
    const backgroundDir = path.join(
      internalDir,
      AGENT_BACKGROUND_FUNCTION_NAME,
    );
    fs.mkdirSync(backgroundDir, { recursive: true });
    fs.writeFileSync(
      path.join(backgroundDir, `${AGENT_BACKGROUND_FUNCTION_NAME}.mjs`),
      "",
    );
    const previous = process.env.AGENT_NATIVE_DISABLE_RECURRING_JOBS;
    delete process.env.AGENT_NATIVE_DISABLE_RECURRING_JOBS;
    vi.spyOn(console, "log").mockImplementation(() => {});
    emitSingleTemplateNetlifyRecurringJobsFunction(tmp);
    if (previous !== undefined) {
      process.env.AGENT_NATIVE_DISABLE_RECURRING_JOBS = previous;
    }
    const entry = path.join(
      internalDir,
      NETLIFY_RECURRING_JOBS_FUNCTION_NAME,
      `${NETLIFY_RECURRING_JOBS_FUNCTION_NAME}.mjs`,
    );
    handler = (await import(pathToFileURL(entry).href)).default;
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const tick = async (at: number) => {
    vi.setSystemTime(at);
    const before = netlify.handoffs.length;
    const response = await handler(
      new Request(
        "https://my-app.netlify.app/.netlify/functions/agent-native-recurring-jobs",
      ),
    );
    expect(response.status).toBe(204);
    return netlify.handoffs.length > before ? "swept" : "skipped";
  };

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("lets an idle app sleep until its next automation is due", async () => {
    const marker = await recordNetlifySweepOutcome({
      startedAt: T0,
      busy: false,
      nextDueAt: T0 + 30 * MINUTE,
      now: T0 + 1_000,
    });
    expect(marker).toEqual({
      sweepAfter: T0 + 30 * MINUTE,
      decidedAt: T0,
    });

    expect(await tick(T0 + MINUTE)).toBe("skipped");
    expect(await tick(T0 + 29 * MINUTE)).toBe("skipped");
    expect(await tick(T0 + 30 * MINUTE)).toBe("swept");
    expect(netlify.handoffs).toEqual([
      "/.netlify/functions/server-agent-background",
    ]);
  });

  it("goes back to sweeping every minute on the first request after an idle verdict", async () => {
    await recordNetlifySweepOutcome({
      startedAt: T0,
      busy: false,
      nextDueAt: null,
      now: T0,
    });
    expect(await tick(T0 + MINUTE)).toBe("skipped");

    await markNetlifyAppActivity(T0 + 2 * MINUTE);
    expect(await tick(T0 + 3 * MINUTE)).toBe("swept");

    const marker = await recordNetlifySweepOutcome({
      startedAt: T0 + 3 * MINUTE,
      busy: false,
      nextDueAt: null,
      now: T0 + 3 * MINUTE,
    });
    expect(marker?.sweepAfter).toBe(T0 + 3 * MINUTE);
    expect(await tick(T0 + 4 * MINUTE)).toBe("swept");
  });

  it("keeps sweeping while a run is in flight", async () => {
    await recordNetlifySweepOutcome({
      startedAt: T0,
      busy: true,
      nextDueAt: null,
      now: T0,
    });

    expect(await tick(T0 + MINUTE)).toBe("swept");
  });

  it("keeps a newer sweep's verdict when an older overlapping sweep finishes last", async () => {
    await recordNetlifySweepOutcome({
      startedAt: T0 + MINUTE,
      busy: true,
      nextDueAt: null,
      now: T0 + 2 * MINUTE,
    });
    await expect(
      recordNetlifySweepOutcome({
        startedAt: T0,
        busy: false,
        nextDueAt: null,
        now: T0 + 3 * MINUTE,
      }),
    ).resolves.toBeNull();

    expect(await tick(T0 + 4 * MINUTE)).toBe("swept");
  });

  it("keeps an older sweep's busy verdict over a newer idle one", async () => {
    await recordNetlifySweepOutcome({
      startedAt: T0 + MINUTE,
      busy: false,
      nextDueAt: null,
      now: T0 + 2 * MINUTE,
    });
    await expect(
      recordNetlifySweepOutcome({
        startedAt: T0,
        busy: true,
        nextDueAt: null,
        now: T0 + 3 * MINUTE,
      }),
    ).resolves.toEqual({ sweepAfter: T0 + 3 * MINUTE, decidedAt: T0 });

    expect(await tick(T0 + 4 * MINUTE)).toBe("swept");
  });

  it("replaces a verdict stamped in the future", async () => {
    netlify.blobs.set(
      markerPath("idle"),
      JSON.stringify({
        sweepAfter: T0 + 90 * MINUTE,
        decidedAt: T0 + 30 * MINUTE,
      }),
    );

    await expect(
      recordNetlifySweepOutcome({
        startedAt: T0,
        busy: true,
        nextDueAt: null,
        now: T0 + MINUTE,
      }),
    ).resolves.toEqual({ sweepAfter: T0 + MINUTE, decidedAt: T0 });
  });

  it("sweeps when the marker is missing or unreadable", async () => {
    expect(await tick(T0)).toBe("swept");

    await recordNetlifySweepOutcome({
      startedAt: T0,
      busy: false,
      nextDueAt: null,
      now: T0,
    });
    netlify.failBlobs();
    expect(await tick(T0 + MINUTE)).toBe("swept");
    expect(console.warn).toHaveBeenCalledWith(
      "[recurring-jobs] Idle marker unreadable; sweeping:",
      'Blobs read of "idle" failed (500)',
    );
  });

  it("sweeps every minute when idle skipping is turned off or Blobs is absent", async () => {
    await recordNetlifySweepOutcome({
      startedAt: T0,
      busy: false,
      nextDueAt: null,
      now: T0,
    });

    process.env.AGENT_NATIVE_IDLE_SWEEP_MAX_MINUTES = "0";
    expect(await tick(T0 + MINUTE)).toBe("swept");

    delete process.env.AGENT_NATIVE_IDLE_SWEEP_MAX_MINUTES;
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    expect(await tick(T0 + 2 * MINUTE)).toBe("swept");
  });

  it("sweeps on a malformed or unreadable marker", async () => {
    netlify.blobs.set(
      markerPath("idle"),
      JSON.stringify({ sweepAfter: T0 + 30 * MINUTE, decidedAt: T0 }),
    );
    expect(await tick(T0 + MINUTE)).toBe("skipped");

    netlify.blobs.set(markerPath("activity"), "{}");
    expect(await tick(T0 + 2 * MINUTE)).toBe("swept");

    netlify.blobs.delete(markerPath("activity"));
    netlify.blobs.set(markerPath("idle"), '{"sweepAfter":1e309,"decidedAt":0}');
    expect(await tick(T0 + 3 * MINUTE)).toBe("swept");

    netlify.blobs.set(
      markerPath("idle"),
      JSON.stringify({ sweepAfter: T0 + 30 * MINUTE, decidedAt: "soon" }),
    );
    expect(await tick(T0 + 4 * MINUTE)).toBe("swept");

    netlify.blobs.set(
      markerPath("idle"),
      JSON.stringify({ sweepAfter: T0 + 30 * MINUTE, decidedAt: T0 }),
    );
    netlify.blobs.set(markerPath("activity"), "null");
    expect(await tick(T0 + 5 * MINUTE)).toBe("swept");

    netlify.blobs.delete(markerPath("activity"));
    netlify.blobs.set(markerPath("idle"), "null");
    expect(await tick(T0 + 6 * MINUTE)).toBe("swept");

    netlify.blobs.set(
      markerPath("idle"),
      JSON.stringify({
        sweepAfter: T0 + 30 * MINUTE,
        decidedAt: T0 + 10 * MINUTE,
      }),
    );
    expect(await tick(T0 + 7 * MINUTE)).toBe("swept");
  });

  it("keeps ten minutes of sweeps, plus one write timeout, for a visit that lands after the verdict it predates", async () => {
    netlify.blobs.set(
      markerPath("idle"),
      JSON.stringify({
        sweepAfter: T0 + 60 * MINUTE,
        decidedAt: T0 + 3 * MINUTE,
      }),
    );
    netlify.blobs.set(
      markerPath("activity"),
      JSON.stringify({ at: T0 + 2 * MINUTE }),
    );

    expect(await tick(T0 + 4 * MINUTE)).toBe("swept");
    expect(await tick(T0 + 12 * MINUTE)).toBe("swept");
    expect(await tick(T0 + 12 * MINUTE + 5_000)).toBe("skipped");
  });

  it("wakes half a minute early and never trusts a verdict past the cap it was decided under", async () => {
    netlify.blobs.set(
      markerPath("idle"),
      JSON.stringify({ sweepAfter: T0 + 50 * MINUTE, decidedAt: T0 }),
    );

    expect(await tick(T0 + 49 * MINUTE)).toBe("skipped");
    expect(await tick(T0 + 49 * MINUTE + 30_000)).toBe("swept");

    process.env.AGENT_NATIVE_IDLE_SWEEP_MAX_MINUTES = "15";
    expect(await tick(T0 + MINUTE)).toBe("skipped");
    expect(await tick(T0 + 14 * MINUTE + 30_000)).toBe("swept");
    expect(await tick(T0 + 44 * MINUTE)).toBe("swept");
    expect(await tick(T0 + 45 * MINUTE)).toBe("swept");
  });

  it("neither records nor trusts a verdict without an uncached Blobs read", async () => {
    netlify.blobs.set(
      markerPath("idle"),
      JSON.stringify({ sweepAfter: T0 + 30 * MINUTE, decidedAt: T0 }),
    );
    process.env.NETLIFY_BLOBS_CONTEXT = blobsContext(false);

    expect(await tick(T0 + MINUTE)).toBe("swept");
    await expect(
      recordNetlifySweepOutcome({
        startedAt: T0 + MINUTE,
        busy: false,
        nextDueAt: null,
        now: T0 + MINUTE,
      }),
    ).resolves.toBeNull();
    expect(netlify.blobs.get(markerPath("idle"))).toBe(
      JSON.stringify({ sweepAfter: T0 + 30 * MINUTE, decidedAt: T0 }),
    );
  });

  it("never fails a sweep over a marker it could not write", async () => {
    netlify.failBlobs();

    await expect(
      recordNetlifySweepOutcome({
        startedAt: T0,
        busy: false,
        nextDueAt: null,
        now: T0,
      }),
    ).resolves.toBeNull();
  });
});
