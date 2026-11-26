import { gunzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import {
  PAGE_TRACK_CHUNK_BYTES,
  PageTrack,
  buildPageTrackFinalizeBody,
  classifyChunkReply,
  classifyFinalizeReply,
  gzipText,
  isPageEventLine,
  type PageTrackCommand,
  type PageTrackOptions,
  type PageTrackPort,
} from "./page-track";

const TRACKS_URL = "https://clips.example/api/uploads/rec-1/tracks";
const WALL_START = Date.UTC(2026, 10, 26, 15, 0, 0);

const meta = JSON.stringify({
  type: 4,
  data: { href: "https://app.example/", width: 1280, height: 720 },
  timestamp: WALL_START + 500,
});
const fullSnapshot = JSON.stringify({
  type: 2,
  data: { node: { type: 0, childNodes: [], id: 1 } },
  timestamp: WALL_START + 500,
});
const scroll = JSON.stringify({
  type: 3,
  data: { source: 3, id: 1, x: 0, y: 240 },
  timestamp: WALL_START + 8_400,
});

type Call = { url: string; body: Blob | string };

function fakePort() {
  const sent: PageTrackCommand[] = [];
  let receive: (message: unknown) => void = () => undefined;
  let drop: () => void = () => undefined;
  const disconnect = vi.fn();
  const port: PageTrackPort = {
    postMessage: (message) => {
      sent.push(message);
    },
    disconnect,
    onMessage: {
      addListener: (listener) => {
        receive = listener;
      },
    },
    onDisconnect: {
      addListener: (listener) => {
        drop = listener;
      },
    },
  };
  return {
    port,
    sent,
    disconnect,
    send: (message: unknown) => receive(message),
    drop: () => drop(),
  };
}

function harness(
  reply: (url: string, attempt: number) => { status: number; body: unknown },
  overrides: Partial<PageTrackOptions> = {},
) {
  let perf = 1_000;
  let wall = WALL_START;
  const calls: Call[] = [];
  const waits: number[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body as Blob | string });
    const answer = reply(url, calls.length);
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
  const track = new PageTrack({
    tracksUrl: TRACKS_URL,
    authToken: "token-1",
    capture: "tab",
    captureWidthPx: 1920,
    captureHeightPx: 1080,
    camera: "none",
    writer: {
      surface: "extension",
      app: "Clips Chrome Extension",
      version: "0.1.24",
      os: "macOS",
    },
    fetch: fetchImpl as unknown as typeof fetch,
    now: () => wall,
    perfNow: () => perf,
    wait: async (ms) => {
      waits.push(ms);
    },
    gzip: async (text) => new Blob([text]),
    ...overrides,
  });
  return {
    track,
    calls,
    waits,
    fetchImpl,
    advance: (ms: number) => {
      perf += ms;
      wall += ms;
    },
  };
}

const ok = () => ({ status: 200, body: { ok: true } });

async function bodyText(body: Blob | string): Promise<string> {
  return typeof body === "string" ? body : body.text();
}

async function bodyOf(calls: Call[], url: string): Promise<string> {
  const call = calls.find((candidate) => candidate.url === url);
  if (!call) throw new Error(`No request to ${url}`);
  return bodyText(call.body);
}

const ONLY_CHUNK_URL = `${TRACKS_URL}/page?index=0&contentType=application%2Fgzip&isFinal=1`;
const FINALIZE_URL = `${TRACKS_URL}/finalize`;

describe("page track recording", () => {
  it("records the page on the recording clock and finalizes it as one track", async () => {
    vi.useFakeTimers();
    try {
      const { track, calls, advance } = harness(ok);
      const page = fakePort();
      track.connect(page.port);
      expect(page.sent).toEqual([]);

      track.start(WALL_START);
      expect(page.sent).toEqual([
        {
          kind: "start",
          paused: false,
          config: {
            checkoutMs: 60_000,
            capture: "tab",
            captureWidthPx: 1920,
            captureHeightPx: 1080,
          },
        },
      ]);

      advance(500);
      page.send({ kind: "events", lines: `${meta}\n${fullSnapshot}` });
      advance(1_000);
      track.pause();
      advance(5_000);
      track.resume();
      advance(2_000);
      page.send({ kind: "events", lines: scroll });

      const finishing = track.finish();
      expect(page.sent.map((command) => command.kind)).toEqual([
        "start",
        "pause",
        "resume",
        "stop",
      ]);
      page.send({ kind: "stopped" });
      await expect(finishing).resolves.toEqual({ status: "finalized" });

      expect(calls.map((call) => call.url)).toEqual([
        ONLY_CHUNK_URL,
        FINALIZE_URL,
      ]);
      await expect(bodyOf(calls, ONLY_CHUNK_URL)).resolves.toBe(
        `${meta}\n${fullSnapshot}\n${scroll}\n`,
      );
      expect(JSON.parse(await bodyOf(calls, FINALIZE_URL))).toEqual({
        status: "complete",
        startedAt: "2026-11-26T15:00:00.000Z",
        durationMs: 3_500,
        writer: {
          surface: "extension",
          app: "Clips Chrome Extension",
          version: "0.1.24",
          os: "macOS",
        },
        clock: {
          host: "performance.now",
          pauses: [{ atMs: 1_500, wallMs: 5_000 }],
        },
        capture: { kind: "tab", displays: [] },
        compat: { offsetMs: 0, cursor: "in-pixels", camera: "none" },
        privacy: { keys: "none", pageInputs: "visible" },
        tracks: [
          {
            id: "page",
            startMs: 500,
            endMs: 3_500,
            complete: true,
            meta: {
              rrweb: "@rrweb/record@2.1.0",
              checkoutMs: 60_000,
              sync: [
                [WALL_START, 0],
                [WALL_START + 1_500, 1_500],
                [WALL_START + 6_500, 1_500],
                [WALL_START + 8_500, 3_500],
              ],
            },
          },
        ],
      });
      expect(page.disconnect).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends whole aligned chunks while recording and the rest as the final chunk", async () => {
    vi.useFakeTimers();
    try {
      const { track, calls } = harness(ok);
      const page = fakePort();
      track.connect(page.port);
      track.start(WALL_START);
      const big = JSON.stringify({
        type: 3,
        data: { text: "x".repeat(Math.floor(PAGE_TRACK_CHUNK_BYTES * 2.5)) },
        timestamp: WALL_START + 10,
      });
      page.send({ kind: "events", lines: big });

      await expect(track.finish()).resolves.toEqual({ status: "finalized" });
      const chunks = calls.slice(0, -1);
      expect(
        chunks.map((call) => new URL(call.url).searchParams.get("index")),
      ).toEqual(["0", "1", "2"]);
      expect(
        chunks.map((call) => new URL(call.url).searchParams.get("isFinal")),
      ).toEqual([null, null, "1"]);
      expect(chunks.map((call) => (call.body as Blob).size)).toEqual([
        PAGE_TRACK_CHUNK_BYTES,
        PAGE_TRACK_CHUNK_BYTES,
        big.length + 1 - 2 * PAGE_TRACK_CHUNK_BYTES,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a chunk the server asks to send again", async () => {
    vi.useFakeTimers();
    try {
      const { track, calls, waits } = harness((_url, attempt) =>
        attempt === 1
          ? { status: 503, body: { ok: false, retryable: true } }
          : { status: 200, body: { ok: true } },
      );
      const page = fakePort();
      track.connect(page.port);
      track.start(WALL_START);
      page.send({ kind: "events", lines: meta });

      await expect(track.finish()).resolves.toEqual({ status: "finalized" });
      expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
        "/api/uploads/rec-1/tracks/page",
        "/api/uploads/rec-1/tracks/page",
        "/api/uploads/rec-1/tracks/finalize",
      ]);
      expect(waits).toContain(500);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops keeping the track when the server stops the tracks", async () => {
    vi.useFakeTimers();
    try {
      const { track, calls } = harness(() => ({
        status: 403,
        body: { ok: false, labDisabled: true, tracksStopped: true },
      }));
      const page = fakePort();
      track.connect(page.port);
      track.start(WALL_START);
      page.send({ kind: "events", lines: meta });

      await expect(track.finish()).resolves.toMatchObject({
        status: "stopped",
      });
      expect(calls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves out lines that aren't rrweb events and marks the track incomplete", async () => {
    vi.useFakeTimers();
    try {
      const { track, calls } = harness(ok);
      const page = fakePort();
      track.connect(page.port);
      track.start(WALL_START);
      page.send({ kind: "events", lines: `not json\n${meta}\n{"type":"x"}` });

      await expect(track.finish()).resolves.toEqual({ status: "finalized" });
      await expect(bodyOf(calls, ONLY_CHUNK_URL)).resolves.toBe(`${meta}\n`);
      const finalize = JSON.parse(await bodyOf(calls, FINALIZE_URL)) as {
        tracks: Array<{ complete: boolean }>;
      };
      expect(finalize.tracks.map((entry) => entry.complete)).toEqual([false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the track incomplete when the page doesn't confirm it stopped", async () => {
    vi.useFakeTimers();
    try {
      const { track, calls } = harness(ok);
      const page = fakePort();
      track.connect(page.port);
      track.start(WALL_START);
      page.send({ kind: "events", lines: meta });

      await expect(track.finish()).resolves.toEqual({ status: "finalized" });
      const finalize = JSON.parse(await bodyOf(calls, FINALIZE_URL)) as {
        tracks: Array<{ complete: boolean }>;
      };
      expect(finalize.tracks.map((entry) => entry.complete)).toEqual([false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs the pause a recording stops in", async () => {
    vi.useFakeTimers();
    try {
      const { track, calls, advance } = harness(ok);
      const page = fakePort();
      track.connect(page.port);
      track.start(WALL_START);
      advance(200);
      page.send({ kind: "events", lines: meta });
      advance(800);
      track.pause();
      advance(3_000);

      const finishing = track.finish();
      page.send({ kind: "stopped" });
      await expect(finishing).resolves.toEqual({ status: "finalized" });
      const finalize = JSON.parse(await bodyOf(calls, FINALIZE_URL)) as {
        durationMs: number;
        clock: { pauses: unknown[] };
      };
      expect(finalize.durationMs).toBe(1_000);
      expect(finalize.clock.pauses).toEqual([{ atMs: 1_000, wallMs: 3_000 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying a chunk once the recording is discarded", async () => {
    let release: () => void = () => undefined;
    const { track, calls } = harness(
      () => ({ status: 503, body: { ok: false, retryable: true } }),
      {
        wait: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      },
    );
    const page = fakePort();
    track.connect(page.port);
    track.start(WALL_START);
    page.send({
      kind: "events",
      lines: JSON.stringify({
        type: 3,
        data: { text: "x".repeat(PAGE_TRACK_CHUNK_BYTES * 2) },
        timestamp: WALL_START + 10,
      }),
    });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });

    track.discard();
    release();
    await expect(track.finish()).resolves.toEqual({
      status: "stopped",
      reason: "discarded",
    });
    expect(calls).toHaveLength(1);
  });

  it("sends a chunk again when its answer couldn't be read", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const fetchImpl = vi.fn(async (url: string) => {
        attempts += 1;
        if (attempts === 1) {
          return {
            status: 200,
            text: () => Promise.reject(new Error("connection reset")),
          } as unknown as Response;
        }
        return new Response(
          JSON.stringify(
            url.endsWith("/finalize")
              ? { ok: true }
              : { ok: true, duplicate: true },
          ),
          { status: 200 },
        );
      });
      const { track } = harness(ok, {
        fetch: fetchImpl as unknown as typeof fetch,
      });
      const page = fakePort();
      track.connect(page.port);
      track.start(WALL_START);
      page.send({ kind: "events", lines: meta });

      await expect(track.finish()).resolves.toEqual({ status: "finalized" });
      expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
        ONLY_CHUNK_URL,
        ONLY_CHUNK_URL,
        FINALIZE_URL,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the track as discarded when the recording is dropped while it finalizes", async () => {
    let answerFinalize: () => void = () => undefined;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/finalize")) {
        await new Promise<void>((resolve) => {
          answerFinalize = resolve;
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { track } = harness(ok, {
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const page = fakePort();
    track.connect(page.port);
    track.start(WALL_START);
    page.send({ kind: "events", lines: meta });

    const outcome = track.finish();
    await vi.waitFor(() => {
      expect(fetchImpl.mock.calls.map(([url]) => url)).toContain(FINALIZE_URL);
    });
    track.discard();
    answerFinalize();
    await expect(outcome).resolves.toEqual({
      status: "stopped",
      reason: "discarded",
    });
  });

  it("sends nothing when the page never sent an event", async () => {
    vi.useFakeTimers();
    try {
      const { track, fetchImpl } = harness(ok);
      track.start(WALL_START);

      await expect(track.finish()).resolves.toEqual({ status: "empty" });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells a page that connects after a pause to start paused, and turns away one after stop", async () => {
    vi.useFakeTimers();
    try {
      const { track } = harness(ok);
      track.start(WALL_START);
      track.pause();
      const reloaded = fakePort();
      track.connect(reloaded.port);
      expect(reloaded.sent).toMatchObject([{ kind: "start", paused: true }]);

      await track.finish();
      const late = fakePort();
      track.connect(late.port);
      expect(late.disconnect).toHaveBeenCalled();
      expect(late.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("page track files", () => {
  it("appends gzip members that read back as one file", async () => {
    const first = await gzipText(`${meta}\n`);
    const second = await gzipText(`${scroll}\n`);
    const joined = Buffer.concat([
      Buffer.from(await first.arrayBuffer()),
      Buffer.from(await second.arrayBuffer()),
    ]);

    expect(gunzipSync(joined).toString("utf8")).toBe(`${meta}\n${scroll}\n`);
  });

  it("accepts only JSON objects with an rrweb type and timestamp", () => {
    expect(isPageEventLine(meta)).toBe(true);
    expect(isPageEventLine("[]")).toBe(false);
    expect(isPageEventLine('{"type":2}')).toBe(false);
    expect(isPageEventLine("not json")).toBe(false);
  });

  it("never lets the recording end before the page track does", () => {
    const body = buildPageTrackFinalizeBody({
      startedAtMs: WALL_START,
      durationMs: 1_000,
      pauses: [],
      capture: "window",
      camera: "bubble",
      writer: {
        surface: "extension",
        app: "Clips Chrome Extension",
        version: "0.1.24",
        os: "Windows",
      },
      startMs: 40,
      endMs: 1_200,
      complete: true,
      sync: [],
    });

    expect(body.durationMs).toBe(1_200);
    expect(body.capture.kind).toBe("window");
    expect(body.compat.camera).toBe("bubble");
  });
});

describe("page track replies", () => {
  it("classifies chunk replies the way the track route answers", () => {
    expect(classifyChunkReply(200, '{"ok":true}')).toEqual({ kind: "stored" });
    expect(
      classifyChunkReply(
        413,
        '{"ok":false,"tracksStopped":true,"error":"full"}',
      ),
    ).toEqual({ kind: "stopped", reason: "413: full" });
    expect(classifyChunkReply(409, '{"ok":false,"retryable":true}').kind).toBe(
      "retry",
    );
    expect(classifyChunkReply(502, "<html>").kind).toBe("retry");
    expect(
      classifyChunkReply(409, '{"ok":false,"staleAttempt":true}').kind,
    ).toBe("rejected");
  });

  it("treats a finalize that kept no tracks as stopped", () => {
    expect(
      classifyFinalizeReply(200, '{"ok":true,"tracksStopped":true}').kind,
    ).toBe("stopped");
    expect(
      classifyFinalizeReply(
        200,
        '{"ok":true,"tracksStopped":true,"alreadyFinalized":true}',
      ),
    ).toEqual({ kind: "stored" });
    expect(
      classifyFinalizeReply(409, '{"ok":false,"retryable":true}').kind,
    ).toBe("retry");
  });
});
