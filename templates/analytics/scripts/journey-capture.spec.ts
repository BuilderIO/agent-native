import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  captureBrowserRecording,
  createCaptureSignalHandler,
  installReplayNetworkPolicy,
  isReplayRequestAllowed,
  loadReplayEvents,
  preparePrivateOutputDirectory,
  requestAppResponse,
  removeStaleRunMetadata,
  runPool,
  signalExitCode,
  writePromptProvenanceSidecar,
  type Browser,
  type BrowserContext,
  type BrowserPage,
  type BrowserRoute,
  type BrowserWebSocketRoute,
  type RunContext,
} from "./journey-capture";
import type { RecordingPlan } from "./journey-capture-plan";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test_server_address_unavailable");
  }
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

const requestOptions = {
  timeoutMs: 1_000,
  maxBytes: 1_024,
};

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

const recordingPlan: RecordingPlan = {
  recordingId: "sr_1",
  items: [
    {
      nodeKey: "first",
      exampleIndex: 0,
      recordingId: "sr_1",
      offsetMs: 10,
      viewport: { width: 1, height: 1 },
      sourceEventAt: "source-event-one",
    },
    {
      nodeKey: "second",
      exampleIndex: 1,
      recordingId: "sr_1",
      offsetMs: 20,
      viewport: { width: 1, height: 1 },
      sourceEventAt: "source-event-two",
    },
  ],
};

describe("journey capture network requests", () => {
  it("routes every page request, blocks private destinations, and strips cross-origin credentials", async () => {
    let websocketHandler: ((route: BrowserWebSocketRoute) => void) | undefined;
    let routeHandler: ((route: BrowserRoute) => Promise<void>) | undefined;
    const context = {
      route: vi.fn(
        async (
          _url: string,
          handler: (route: BrowserRoute) => Promise<void>,
        ) => {
          routeHandler = handler;
        },
      ),
      unroute: vi.fn(async () => undefined),
      routeWebSocket: vi.fn(
        async (
          _url: string,
          handler: (route: BrowserWebSocketRoute) => void,
        ) => {
          websocketHandler = handler;
        },
      ),
    } as unknown as BrowserContext;
    const signal = new AbortController().signal;
    const policy = await installReplayNetworkPolicy(
      context,
      "https://analytics.example.com",
      signal,
    );
    expect(context.route).toHaveBeenCalledWith("**/*", expect.any(Function));
    expect(context.routeWebSocket).toHaveBeenCalledWith(
      "**/*",
      expect.any(Function),
    );
    const continueRequest = vi.fn(async () => undefined);
    const abortRequest = vi.fn(async () => undefined);
    const dispatch = async (
      url: string,
      method = "GET",
      headers: Record<string, string> = {},
    ) =>
      routeHandler!({
        request: () => ({
          url: () => url,
          method: () => method,
          allHeaders: async () => headers,
        }),
        abort: abortRequest,
        continue: continueRequest,
      });

    await dispatch("https://8.8.8.8/replay-image.png", "GET", {
      authorization: "Bearer must-not-leave",
      "proxy-authorization": "Basic must-not-leave",
      "x-api-key": "custom-key-must-not-leave",
      "x-auth-token": "custom-token-must-not-leave",
      "x-trace-id": "unapproved-header",
      origin: "https://analytics.example.com",
      referer:
        "https://analytics.example.com/sessions/replay?agent_access=grant",
      accept: "image/png",
      range: "bytes=0-1023",
      "sec-fetch-dest": "image",
    });
    expect(continueRequest).toHaveBeenLastCalledWith({
      headers: {
        origin: "https://analytics.example.com",
        accept: "image/png",
        range: "bytes=0-1023",
        "sec-fetch-dest": "image",
      },
    });

    await dispatch("https://8.8.8.8/cookie", "GET", {
      cookie: "session=must-not-leave",
    });
    expect(abortRequest).toHaveBeenCalledOnce();
    await dispatch("http://169.254.169.254/latest/meta-data");
    expect(abortRequest).toHaveBeenCalledTimes(2);
    await dispatch("https://8.8.8.8/collect", "POST");
    expect(abortRequest).toHaveBeenCalledTimes(3);

    const closeWebSocket = vi.fn();
    websocketHandler!({ close: closeWebSocket });
    expect(closeWebSocket).toHaveBeenCalledOnce();
    expect(
      await isReplayRequestAllowed(
        "http://127.0.0.1:1234/",
        "https://analytics.example.com",
      ),
    ).toBe(false);
    await policy.close();
    expect(context.unroute).toHaveBeenCalledWith("**/*", routeHandler);
  });

  it("aborts one unresolved replay asset without poisoning the recording policy", async () => {
    let routeHandler: ((route: BrowserRoute) => Promise<void>) | undefined;
    const context = {
      route: vi.fn(
        async (
          _url: string,
          handler: (route: BrowserRoute) => Promise<void>,
        ) => {
          routeHandler = handler;
        },
      ),
      unroute: vi.fn(async () => undefined),
      routeWebSocket: vi.fn(async () => undefined),
    } as unknown as BrowserContext;
    const policy = await installReplayNetworkPolicy(
      context,
      "https://analytics.example.com",
      new AbortController().signal,
      (requestUrl, appUrl) =>
        isReplayRequestAllowed(requestUrl, appUrl, async () => {
          throw new Error("dns_lookup_failed");
        }),
    );
    const abort = vi.fn(async () => undefined);
    await routeHandler!({
      request: () => ({
        url: () => "https://recorded-assets.example.org/frame.png",
        method: () => "GET",
        allHeaders: async () => ({}),
      }),
      abort,
      continue: vi.fn(async () => undefined),
    });

    expect(abort).toHaveBeenCalledOnce();
    await expect(policy.assertHealthy()).resolves.toBeUndefined();
    await policy.close();
  });

  it("connects to an available loopback family for localhost", async () => {
    const server = createServer((_request, response) => response.end("ok"));
    const port = await listen(server);

    try {
      const response = await requestAppResponse(
        `http://localhost:${port}/`,
        requestOptions,
      );
      expect(response.status).toBe(200);
      expect(response.bodyText).toBe("ok");
    } finally {
      await close(server);
    }
  });

  it("rejects non-public IPv6 destinations before connecting", async () => {
    await expect(
      requestAppResponse("https://[2001:db8::1]/", requestOptions),
    ).rejects.toThrow("app_network_target_blocked");
    await expect(
      requestAppResponse("https://[2001:2::1]/", requestOptions),
    ).rejects.toThrow("app_network_target_blocked");
  });

  it("rejects plain HTTP outside exact loopback", async () => {
    await expect(
      requestAppResponse("http://93.184.216.34/", requestOptions),
    ).rejects.toThrow("app_request_url_invalid");
  });

  it("returns redirects without following them", async () => {
    let redirectedRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === "/redirect-target") redirectedRequests += 1;
      response.writeHead(
        request.url === "/start" ? 302 : 200,
        request.url === "/start" ? { location: "/redirect-target" } : {},
      );
      response.end();
    });
    const port = await listen(server);

    try {
      const response = await requestAppResponse(
        "http://127.0.0.1:" + port + "/start",
        requestOptions,
      );
      expect(response.status).toBe(302);
      expect(redirectedRequests).toBe(0);
    } finally {
      await close(server);
    }
  });

  it("rejects oversized responses with a typed failure", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-length": "2048" });
      response.end("x".repeat(2048));
    });
    const port = await listen(server);

    try {
      await expect(
        requestAppResponse("http://127.0.0.1:" + port + "/", {
          timeoutMs: 1_000,
          maxBytes: 1_024,
        }),
      ).rejects.toThrow("app_response_too_large");
    } finally {
      await close(server);
    }
  });

  it("caps streamed bodies when content length is absent", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200);
      response.end("x".repeat(2048));
    });
    const port = await listen(server);

    try {
      await expect(
        requestAppResponse("http://127.0.0.1:" + port + "/", {
          timeoutMs: 1_000,
          maxBytes: 1_024,
        }),
      ).rejects.toThrow("app_response_too_large");
    } finally {
      await close(server);
    }
  });

  it("applies an absolute timeout while response bytes keep arriving", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200);
      const interval = setInterval(() => response.write("x"), 10);
      response.on("close", () => clearInterval(interval));
    });
    const port = await listen(server);

    try {
      await expect(
        requestAppResponse("http://127.0.0.1:" + port + "/", {
          timeoutMs: 150,
          maxBytes: 1_024,
        }),
      ).rejects.toThrow("app_request_timeout");
    } finally {
      await close(server);
    }
  });

  it("aborts an in-flight request when the run signal is canceled", async () => {
    let resolveRequestReceived: (() => void) | undefined;
    let resolveResponseClosed: (() => void) | undefined;
    let didCloseResponse = false;
    const requestReceived = new Promise<void>((resolve) => {
      resolveRequestReceived = resolve;
    });
    const responseClosed = new Promise<void>((resolve) => {
      resolveResponseClosed = resolve;
    });
    const server = createServer((_request, response) => {
      response.writeHead(200);
      response.write("pending");
      resolveRequestReceived?.();
      response.on("close", () => {
        didCloseResponse = true;
        resolveResponseClosed?.();
      });
    });
    const port = await listen(server);
    const controller = new AbortController();

    try {
      const pending = requestAppResponse("http://127.0.0.1:" + port + "/", {
        ...requestOptions,
        signal: controller.signal,
      });
      await requestReceived;
      controller.abort(new Error("run_stopped: SIGINT"));
      await expect(pending).rejects.toThrow("run_stopped: SIGINT");
      let closeTimeout: NodeJS.Timeout | undefined;
      await Promise.race([
        responseClosed,
        new Promise<void>((resolve) => {
          closeTimeout = setTimeout(resolve, 1_000);
        }),
      ]);
      if (closeTimeout) clearTimeout(closeTimeout);
      expect(didCloseResponse).toBe(true);
    } finally {
      await close(server);
    }
  });
});

describe("capture cancellation", () => {
  it("stops scheduling work after aborting a run pool", async () => {
    const controller = new AbortController();
    const started: number[] = [];

    await expect(
      runPool(
        [1, 2, 3],
        1,
        async (item) => {
          started.push(item);
          controller.abort(new Error("run_stopped: SIGINT"));
        },
        controller.signal,
      ),
    ).rejects.toThrow("run_stopped: SIGINT");
    expect(started).toEqual([1]);
  });

  it("closes Chromium on the first signal and force exits on the second", () => {
    const controller = new AbortController();
    const closeBrowser = vi.fn(async () => undefined);
    const onFirstSignal = vi.fn();
    const onSecondSignal = vi.fn((signal: NodeJS.Signals) =>
      signalExitCode(signal),
    );
    const handleSignal = createCaptureSignalHandler(
      controller,
      closeBrowser,
      onFirstSignal,
      onSecondSignal,
    );

    handleSignal("SIGINT");
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toMatchObject({
      message: "run_stopped: SIGINT",
    });
    expect(closeBrowser).toHaveBeenCalledOnce();
    expect(onFirstSignal).toHaveBeenCalledWith("SIGINT");

    handleSignal("SIGTERM");
    expect(onSecondSignal).toHaveBeenCalledWith("SIGTERM");
    expect(onSecondSignal.mock.results[0]?.value).toBe(143);
  });
});

describe("journey replay prefix loading", () => {
  it("reads through the end of a timestamp group that crosses a batch boundary", async () => {
    const recordId = "recording-1";
    const accessToken = "scoped-token";
    const chunkData = Array.from({ length: 10 }, (_, index) => {
      const event = {
        id: `event-${index}`,
        type: index === 0 ? 4 : index === 1 ? 2 : 3,
        timestamp: index === 0 ? 500 : index === 9 ? 1_001 : 1_000,
        data:
          index === 0
            ? {
                href: "https://app.example.test/onboarding",
                width: 1280,
                height: 720,
              }
            : index === 1
              ? { node: { type: 0, childNodes: [] } }
              : { source: 0 },
      };
      const body = JSON.stringify([event]);
      return {
        body,
        checksum: createHash("sha256").update(body, "utf8").digest("hex"),
        event,
        seq: index,
      };
    });
    const chunks = chunkData.map(({ body, checksum, seq }) => ({
      bytesPath: `/api/session-replay/recordings/${recordId}/chunks/${seq}?agent_access=${accessToken}`,
      checksum,
      byteLength: Buffer.byteLength(body, "utf8"),
      eventCount: 1,
      seq,
    }));
    const manifest = {
      recording: {
        id: recordId,
        startedAt: new Date(400).toISOString(),
        eventCount: chunkData.length,
        totalBytes: chunkData.reduce(
          (sum, chunk) => sum + Buffer.byteLength(chunk.body, "utf8"),
          0,
        ),
        chunkCount: chunkData.length,
      },
      chunks,
    };
    const requestedChunks: number[] = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname.endsWith("/manifest")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(manifest));
        return;
      }
      const match = /\/chunks\/(\d+)$/.exec(url.pathname);
      if (!match) {
        response.writeHead(404).end();
        return;
      }
      const seq = Number(match[1]);
      const chunk = chunkData[seq]!;
      requestedChunks.push(seq);
      response.writeHead(200, {
        "content-type": "application/json",
        "x-session-replay-seq": String(seq),
        "x-session-replay-checksum": chunk.checksum,
      });
      response.end(chunk.body);
    });
    const port = await listen(server);
    const appUrl = `http://127.0.0.1:${port}`;

    try {
      const replay = await loadReplayEvents(
        `${appUrl}/api/session-replay/agent-context.json?id=${recordId}&agent_access=${accessToken}`,
        appUrl,
        recordId,
        600,
        1_000,
      );

      expect(replay.recordingStartedAtMs).toBe(400);
      expect(replay.events.map((event) => event.id)).toEqual(
        chunkData.map((chunk) => chunk.event.id),
      );
      expect(requestedChunks.sort((a, b) => a - b)).toEqual(
        chunkData.map((chunk) => chunk.seq),
      );
    } finally {
      await close(server);
    }
  });

  it("rejects an oversized required prefix before fetching the next chunk", async () => {
    const recordId = "recording-oversized-prefix";
    const accessToken = "scoped-token";
    const firstEvent = {
      id: "event-0",
      type: 4,
      timestamp: 500,
      data: { href: "https://app.example.test/", width: 1280, height: 720 },
    };
    const firstBody = JSON.stringify([firstEvent]);
    const firstChecksum = createHash("sha256")
      .update(firstBody, "utf8")
      .digest("hex");
    const chunks = [
      {
        bytesPath: `/api/session-replay/recordings/${recordId}/chunks/0?agent_access=${accessToken}`,
        checksum: firstChecksum,
        byteLength: Buffer.byteLength(firstBody, "utf8"),
        eventCount: 1,
        seq: 0,
      },
      {
        bytesPath: `/api/session-replay/recordings/${recordId}/chunks/1?agent_access=${accessToken}`,
        checksum: "a".repeat(64),
        byteLength: 2,
        eventCount: 100_000,
        seq: 1,
      },
    ];
    const manifest = {
      recording: {
        id: recordId,
        startedAt: new Date(400).toISOString(),
        eventCount: 100_001,
        totalBytes: chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
        chunkCount: chunks.length,
      },
      chunks,
    };
    const requestedChunks: number[] = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname.endsWith("/manifest")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(manifest));
        return;
      }
      const match = /\/chunks\/(\d+)$/.exec(url.pathname);
      if (!match) {
        response.writeHead(404).end();
        return;
      }
      const seq = Number(match[1]);
      requestedChunks.push(seq);
      response.writeHead(200, {
        "content-type": "application/json",
        "x-session-replay-seq": String(seq),
        "x-session-replay-checksum": firstChecksum,
      });
      response.end(firstBody);
    });
    const port = await listen(server);
    const appUrl = `http://127.0.0.1:${port}`;

    try {
      await expect(
        loadReplayEvents(
          `${appUrl}/api/session-replay/agent-context.json?id=${recordId}&agent_access=${accessToken}`,
          appUrl,
          recordId,
          100,
          1_000,
        ),
      ).rejects.toThrow("replay_prefix_too_large");
      expect(requestedChunks).toEqual([0]);
    } finally {
      await close(server);
    }
  });

  it("anchors the prefix target to recording start instead of the first replay event", async () => {
    const recordId = "recording-2";
    const accessToken = "scoped-token";
    const chunkData = Array.from({ length: 17 }, (_, index) => {
      const event = {
        id: `event-${index}`,
        type: index === 0 ? 4 : index === 1 ? 2 : 3,
        timestamp:
          index === 0 ? 900 : index === 15 ? 1_350 : index === 16 ? 1_401 : 950,
        data:
          index === 0
            ? {
                href: "https://app.example.test/onboarding",
                width: 1280,
                height: 720,
              }
            : index === 1
              ? { node: { type: 0, childNodes: [] } }
              : { source: 0 },
      };
      const body = JSON.stringify([event]);
      return {
        body,
        checksum: createHash("sha256").update(body, "utf8").digest("hex"),
        event,
        seq: index,
      };
    });
    const chunks = chunkData.map(({ body, checksum, seq }) => ({
      bytesPath: `/api/session-replay/recordings/${recordId}/chunks/${seq}?agent_access=${accessToken}`,
      checksum,
      byteLength: Buffer.byteLength(body, "utf8"),
      eventCount: 1,
      seq,
    }));
    const manifest = {
      recording: {
        id: recordId,
        startedAt: new Date(800).toISOString(),
        eventCount: chunkData.length,
        totalBytes: chunkData.reduce(
          (sum, chunk) => sum + Buffer.byteLength(chunk.body, "utf8"),
          0,
        ),
        chunkCount: chunkData.length,
      },
      chunks,
    };
    const requestedChunks: number[] = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname.endsWith("/manifest")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(manifest));
        return;
      }
      const match = /\/chunks\/(\d+)$/.exec(url.pathname);
      if (!match) {
        response.writeHead(404).end();
        return;
      }
      const seq = Number(match[1]);
      const chunk = chunkData[seq]!;
      requestedChunks.push(seq);
      response.writeHead(200, {
        "content-type": "application/json",
        "x-session-replay-seq": String(seq),
        "x-session-replay-checksum": chunk.checksum,
      });
      response.end(chunk.body);
    });
    const port = await listen(server);
    const appUrl = `http://127.0.0.1:${port}`;

    try {
      const replay = await loadReplayEvents(
        `${appUrl}/api/session-replay/agent-context.json?id=${recordId}&agent_access=${accessToken}`,
        appUrl,
        recordId,
        500,
        1_000,
      );

      expect(replay.recordingStartedAtMs).toBe(800);
      expect(replay.events.map((event) => event.id)).toEqual(
        chunkData.slice(0, 16).map((chunk) => chunk.event.id),
      );
      expect(requestedChunks.sort((a, b) => a - b)).toEqual(
        chunkData.slice(0, 16).map((chunk) => chunk.seq),
      );
    } finally {
      await close(server);
    }
  });
});

describe("browser journey capture", () => {
  it("loads once, keeps browser credentials empty, uploads only PNGs, and records failed assets", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "journey-capture-"));
    await chmod(outDir, 0o700);
    const png = Buffer.from(pngHeader(1, 1)).toString("base64");
    const uploads: string[] = [];
    const appServer = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer | string) =>
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
      );
      request.on("end", () => {
        uploads.push(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ result: { attachmentRef: "private:test" } }),
        );
      });
    });
    const port = await listen(appServer);
    const replies: unknown[] = [
      { status: "ready", recordingStartedAt: "2026-10-09T00:00:00.000Z" },
      {
        ok: true,
        value: {
          offsetMs: 10,
          playheadOffsetMs: 5,
          width: 1,
          height: 1,
          route: "/start",
          capturedAt: "2026-10-09T00:00:00.010Z",
          png,
        },
      },
      {
        ok: true,
        value: {
          observedOffsetMs: 10,
          playheadOffsetMs: 5,
          observedAt: "2026-10-09T00:00:00.011Z",
          messages: [{ role: "user", text: "api_key=example-secret" }],
          truncatedMessages: true,
          truncatedCharacters: true,
        },
      },
      { ok: false, reason: "assets_not_capturable" },
      {
        ok: true,
        value: {
          observedOffsetMs: 20,
          playheadOffsetMs: 15,
          observedAt: "2026-10-09T00:00:00.021Z",
          messages: [{ role: "user", text: "second prompt" }],
          truncatedMessages: false,
          truncatedCharacters: false,
        },
      },
    ];
    const page = {
      goto: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(async <T>() => replies.shift() as T),
    } as unknown as BrowserPage;
    const context = {
      newPage: vi.fn(async () => page),
      route: vi.fn(async () => undefined),
      unroute: vi.fn(async () => undefined),
      routeWebSocket: vi.fn(async () => undefined),
      clearCookies: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } as unknown as BrowserContext;
    const newContext = vi.fn(
      async (_options: Record<string, unknown>) => context,
    );
    const browser = { newContext } as unknown as Browser;
    const ctx: RunContext = {
      appUrl: `http://127.0.0.1:${port}`,
      token: "test-only-app-bearer",
      signal: new AbortController().signal,
      browser,
      outDir,
      timeoutMs: 1_000,
      upload: true,
      captureMode: "browser",
      extractPrompts: true,
      minAspect: undefined,
      maxAspect: undefined,
      usedNames: new Set<string>(),
      frames: [],
      failures: [],
      provenanceSnapshots: [],
      provenanceFailures: [],
      provenanceOmittedSnapshots: 0,
      provenanceInFlight: 0,
    };
    const frameUrl = `http://127.0.0.1:${port}/sessions/sr_1?agent_access=scoped-grant&frame=1&capture_through_ms=20`;

    try {
      await preparePrivateOutputDirectory(outDir, process.cwd());
      await captureBrowserRecording(ctx, recordingPlan, frameUrl);

      expect(newContext).toHaveBeenCalledTimes(1);
      expect(newContext).toHaveBeenCalledWith(
        expect.objectContaining({
          storageState: { cookies: [], origins: [] },
          serviceWorkers: "block",
        }),
      );
      const browserContextOptions = newContext.mock.calls[0]?.[0];
      expect(browserContextOptions).not.toHaveProperty("extraHTTPHeaders");
      expect(browserContextOptions).not.toHaveProperty("httpCredentials");
      expect(page.goto).toHaveBeenCalledTimes(1);
      expect(page.goto).toHaveBeenCalledWith(
        frameUrl,
        expect.objectContaining({ waitUntil: "domcontentloaded" }),
      );
      expect(frameUrl).not.toContain("test-only-app-bearer");
      expect(page.evaluate).toHaveBeenCalledTimes(5);
      expect(context.close).toHaveBeenCalledTimes(1);
      expect(context.clearCookies).toHaveBeenCalledTimes(1);
      expect(uploads).toHaveLength(1);
      expect(uploads[0]).toContain('"png":"');
      expect(uploads[0]).not.toContain("example-secret");
      expect(uploads[0]).not.toContain("second prompt");
      expect(ctx.frames).toMatchObject([
        {
          nodeKey: "first",
          offsetMs: 10,
          replayAt: "2026-10-09T00:00:00.010Z",
          assetStatus: "preflighted",
          width: 1,
          height: 1,
          sourceEventAt: "source-event-one",
        },
      ]);
      expect(ctx.failures).toMatchObject([
        {
          nodeKey: "second",
          reason: "assets_not_capturable",
          assetStatus: "preflight_failed",
        },
      ]);
      const pngPath = path.join(outDir, ctx.frames[0]!.localPath);
      expect((await stat(pngPath)).mode & 0o777).toBe(0o600);
      expect((await stat(outDir)).mode & 0o777).toBe(0o700);

      const sidecarPath = await writePromptProvenanceSidecar(
        outDir,
        "2026-10-09T00:00:00.000Z",
        ctx.provenanceSnapshots,
        ctx.provenanceFailures,
        ctx.provenanceOmittedSnapshots,
        recordingPlan.items.length,
      );
      const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
      expect((await stat(sidecarPath)).mode & 0o777).toBe(0o600);
      expect(sidecar.snapshots[0]).toMatchObject({
        treeSourceEventAt: "source-event-one",
        observedSeek: {
          requestedOffsetMs: 10,
          observedOffsetMs: 10,
          playheadOffsetMs: 5,
        },
        extractorTruncation: {
          truncatedMessages: true,
          truncatedCharacters: true,
        },
        truncation: {
          messages: false,
          messageCharacters: false,
          totalCharacters: false,
        },
        messages: [{ role: "user", text: "api_key=[REDACTED]" }],
      });
      expect(sidecar.coverage.unrecordedSnapshots).toBe(0);
      const serializedSidecar = JSON.stringify(sidecar);
      expect(serializedSidecar).not.toContain("example-secret");
      expect(serializedSidecar).not.toContain("attemptId");
    } finally {
      await close(appServer);
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("treats a timed-out seek as terminal and accounts for all remaining provenance", async () => {
    const outDir = await mkdtemp(
      path.join(os.tmpdir(), "journey-capture-timeout-"),
    );
    const items = [
      ...recordingPlan.items,
      {
        nodeKey: "third",
        exampleIndex: 2,
        recordingId: "sr_1",
        offsetMs: 30,
        viewport: { width: 1, height: 1 },
        sourceEventAt: "source-event-three",
      },
    ];
    const plan: RecordingPlan = { recordingId: "sr_1", items };
    let evaluateCalls = 0;
    const page = {
      goto: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(async <T>() => {
        evaluateCalls += 1;
        if (evaluateCalls === 1) {
          return {
            status: "ready",
            recordingStartedAt: "2026-10-09T00:00:00.000Z",
          } as T;
        }
        return new Promise<T>(() => undefined);
      }),
    } as unknown as BrowserPage;
    const context = {
      newPage: vi.fn(async () => page),
      route: vi.fn(async () => undefined),
      unroute: vi.fn(async () => undefined),
      routeWebSocket: vi.fn(async () => undefined),
      clearCookies: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } as unknown as BrowserContext;
    const browser = {
      newContext: vi.fn(async () => context),
    } as unknown as Browser;
    const ctx: RunContext = {
      appUrl: "https://analytics.example.com",
      token: undefined,
      signal: new AbortController().signal,
      browser,
      outDir,
      timeoutMs: 10,
      upload: false,
      captureMode: "browser",
      extractPrompts: true,
      minAspect: undefined,
      maxAspect: undefined,
      usedNames: new Set<string>(),
      frames: [],
      failures: [],
      provenanceSnapshots: [],
      provenanceFailures: [],
      provenanceOmittedSnapshots: 0,
      provenanceInFlight: 0,
    };

    try {
      await preparePrivateOutputDirectory(outDir, process.cwd());
      await captureBrowserRecording(
        ctx,
        plan,
        "https://analytics.example.com/sessions/sr_1?agent_access=scoped-grant&frame=1&capture_through_ms=20",
      );

      expect(page.evaluate).toHaveBeenCalledTimes(2);
      expect(ctx.frames).toEqual([]);
      expect(ctx.failures).toMatchObject([
        {
          nodeKey: "first",
          reason: expect.stringContaining("capture_timeout"),
        },
        {
          nodeKey: "second",
          reason: "capture_timeout: an earlier frame did not finish",
        },
        {
          nodeKey: "third",
          reason: "capture_timeout: an earlier frame did not finish",
        },
      ]);
      expect(ctx.provenanceFailures).toMatchObject([
        {
          nodeKey: "first",
          reason: expect.stringContaining("capture_timeout"),
        },
        {
          nodeKey: "second",
          reason: "capture_timeout: an earlier frame did not finish",
        },
        {
          nodeKey: "third",
          reason: "capture_timeout: an earlier frame did not finish",
        },
      ]);
      expect(ctx.provenanceInFlight).toBe(0);
      expect(context.close).toHaveBeenCalledOnce();

      const sidecarPath = await writePromptProvenanceSidecar(
        outDir,
        "2026-10-09T00:00:00.000Z",
        ctx.provenanceSnapshots,
        ctx.provenanceFailures,
        ctx.provenanceOmittedSnapshots,
        plan.items.length,
      );
      const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
      expect(sidecar.coverage).toMatchObject({
        plannedSnapshots: 3,
        failedSnapshots: 3,
        unrecordedSnapshots: 0,
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("stops later seeks when prompt extraction times out", async () => {
    const outDir = await mkdtemp(
      path.join(os.tmpdir(), "journey-capture-prompt-timeout-"),
    );
    const png = Buffer.from(pngHeader(1, 1)).toString("base64");
    let evaluateCalls = 0;
    const page = {
      goto: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(async <T>() => {
        evaluateCalls += 1;
        if (evaluateCalls === 1) {
          return {
            status: "ready",
            recordingStartedAt: "2026-10-09T00:00:00.000Z",
          } as T;
        }
        if (evaluateCalls === 2) {
          return {
            ok: true,
            value: {
              offsetMs: 10,
              playheadOffsetMs: 5,
              width: 1,
              height: 1,
              route: "/start",
              capturedAt: "2026-10-09T00:00:00.010Z",
              png,
            },
          } as T;
        }
        return new Promise<T>(() => undefined);
      }),
    } as unknown as BrowserPage;
    const context = {
      newPage: vi.fn(async () => page),
      route: vi.fn(async () => undefined),
      unroute: vi.fn(async () => undefined),
      routeWebSocket: vi.fn(async () => undefined),
      clearCookies: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } as unknown as BrowserContext;
    const browser = {
      newContext: vi.fn(async () => context),
    } as unknown as Browser;
    const ctx: RunContext = {
      appUrl: "https://analytics.example.com",
      token: undefined,
      signal: new AbortController().signal,
      browser,
      outDir,
      timeoutMs: 15,
      upload: false,
      captureMode: "browser",
      extractPrompts: true,
      minAspect: undefined,
      maxAspect: undefined,
      usedNames: new Set<string>(),
      frames: [],
      failures: [],
      provenanceSnapshots: [],
      provenanceFailures: [],
      provenanceOmittedSnapshots: 0,
      provenanceInFlight: 0,
    };

    try {
      await preparePrivateOutputDirectory(outDir, process.cwd());
      await captureBrowserRecording(
        ctx,
        recordingPlan,
        "https://analytics.example.com/sessions/sr_1?agent_access=scoped-grant&frame=1&capture_through_ms=20",
      );

      expect(page.evaluate).toHaveBeenCalledTimes(3);
      expect(ctx.frames).toMatchObject([{ nodeKey: "first" }]);
      expect(ctx.failures).toMatchObject([
        {
          nodeKey: "second",
          reason: "capture_timeout: an earlier frame did not finish",
        },
      ]);
      expect(ctx.provenanceFailures).toMatchObject([
        {
          nodeKey: "first",
          reason: expect.stringContaining("capture_timeout"),
        },
        {
          nodeKey: "second",
          reason: "capture_timeout: an earlier frame did not finish",
        },
      ]);
      expect(ctx.provenanceInFlight).toBe(0);
      expect(context.close).toHaveBeenCalledOnce();
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("records prompt provenance when frame upload fails", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "journey-capture-"));
    await chmod(outDir, 0o700);
    const png = Buffer.from(pngHeader(1, 1)).toString("base64");
    const uploadBodies: string[] = [];
    const appServer = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer | string) =>
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
      );
      request.on("end", () => {
        uploadBodies.push(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(500, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    const port = await listen(appServer);
    const replies: unknown[] = [
      { status: "ready", recordingStartedAt: "2026-10-09T00:00:00.000Z" },
      {
        ok: true,
        value: {
          offsetMs: 10,
          playheadOffsetMs: 5,
          width: 1,
          height: 1,
          route: "/start",
          capturedAt: "2026-10-09T00:00:00.010Z",
          png,
        },
      },
      {
        ok: true,
        value: {
          observedOffsetMs: 10,
          playheadOffsetMs: 5,
          observedAt: "2026-10-09T00:00:00.011Z",
          messages: [{ role: "user", text: "private prompt text" }],
          truncatedMessages: false,
          truncatedCharacters: false,
        },
      },
    ];
    const page = {
      goto: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(async <T>() => replies.shift() as T),
    } as unknown as BrowserPage;
    const context = {
      route: vi.fn(async () => undefined),
      unroute: vi.fn(async () => undefined),
      routeWebSocket: vi.fn(async () => undefined),
      newPage: vi.fn(async () => page),
      clearCookies: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } as unknown as BrowserContext;
    const browser = {
      newContext: vi.fn(async () => context),
    } as unknown as Browser;
    const ctx: RunContext = {
      appUrl: "http://127.0.0.1:" + port,
      token: "test-only-app-bearer",
      signal: new AbortController().signal,
      browser,
      outDir,
      timeoutMs: 1_000,
      upload: true,
      captureMode: "browser",
      extractPrompts: true,
      minAspect: undefined,
      maxAspect: undefined,
      usedNames: new Set<string>(),
      frames: [],
      failures: [],
      provenanceSnapshots: [],
      provenanceFailures: [],
      provenanceOmittedSnapshots: 0,
      provenanceInFlight: 0,
    };
    const plan: RecordingPlan = {
      recordingId: recordingPlan.recordingId,
      items: [recordingPlan.items[0]!],
    };

    try {
      await captureBrowserRecording(
        ctx,
        plan,
        "http://127.0.0.1:" +
          port +
          "/sessions/sr_1?agent_access=scoped-grant&frame=1&capture_through_ms=20",
      );

      expect(ctx.frames).toEqual([]);
      expect(ctx.failures).toMatchObject([
        { nodeKey: "first", reason: expect.stringContaining("upload_failed:") },
      ]);
      expect(ctx.provenanceSnapshots).toMatchObject([
        {
          nodeKey: "first",
          captureOutcome: {
            status: "failed",
            reason: expect.stringContaining("upload_failed:"),
          },
        },
      ]);
      expect(ctx.provenanceFailures).toEqual([]);
      expect(uploadBodies).toHaveLength(1);
      expect(uploadBodies[0]).toContain('"png":"');
      expect(uploadBodies[0]).not.toContain("private prompt text");
      await expect(
        stat(path.join(outDir, "first-0.png")),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });

      const sidecarPath = await writePromptProvenanceSidecar(
        outDir,
        "2026-10-09T00:00:00.000Z",
        ctx.provenanceSnapshots,
        ctx.provenanceFailures,
        ctx.provenanceOmittedSnapshots,
        plan.items.length,
      );
      const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
      expect(sidecar.coverage).toMatchObject({
        plannedSnapshots: 1,
        recordedSnapshots: 1,
        failedSnapshots: 0,
        unrecordedSnapshots: 0,
      });
      expect(sidecar.snapshots[0].captureOutcome).toEqual({
        status: "failed",
        reason: expect.stringContaining("upload_failed:"),
      });
    } finally {
      await close(appServer);
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

describe("private output directory", () => {
  it("rejects protected ancestors before changing their permissions", async () => {
    const ancestor = path.dirname(process.cwd());
    const originalMode = (await stat(ancestor)).mode & 0o777;

    await expect(
      preparePrivateOutputDirectory(ancestor, process.cwd()),
    ).rejects.toThrow("output_directory_too_broad");

    expect((await stat(ancestor)).mode & 0o777).toBe(originalMode);
  });

  it("rejects a shared existing directory without changing its permissions", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "journey-output-"));
    try {
      await chmod(outDir, 0o755);

      await expect(
        preparePrivateOutputDirectory(outDir, process.cwd()),
      ).rejects.toThrow("output_directory_permissions_unsafe");

      expect((await stat(outDir)).mode & 0o777).toBe(0o755);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("keeps an existing private directory unchanged and creates new output privately", async () => {
    const privateDir = await mkdtemp(path.join(os.tmpdir(), "journey-output-"));
    const parent = await mkdtemp(path.join(os.tmpdir(), "journey-output-"));
    const newDir = path.join(parent, "frames");
    try {
      const originalMode = (await stat(privateDir)).mode & 0o777;
      await preparePrivateOutputDirectory(privateDir, process.cwd());
      await preparePrivateOutputDirectory(newDir, process.cwd());

      expect((await stat(privateDir)).mode & 0o777).toBe(originalMode);
      expect((await stat(newDir)).mode & 0o777).toBe(0o700);
    } finally {
      await rm(privateDir, { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe("prompt provenance sidecar", () => {
  it("removes a prior sidecar before a run that does not extract prompts", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "journey-provenance-"));
    try {
      await preparePrivateOutputDirectory(outDir, process.cwd());
      const sidecarPath = await writePromptProvenanceSidecar(
        outDir,
        "2026-10-09T00:00:00.000Z",
        [],
        [],
        0,
        1,
      );

      await removeStaleRunMetadata(outDir);

      await expect(stat(sidecarPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("reports planned seeks with no snapshot or extraction failure", async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "journey-provenance-"));
    try {
      await preparePrivateOutputDirectory(outDir, process.cwd());
      const sidecarPath = await writePromptProvenanceSidecar(
        outDir,
        "2026-10-09T00:00:00.000Z",
        [],
        [],
        0,
        1,
      );
      const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
      expect(sidecar.coverage).toEqual({
        plannedSnapshots: 1,
        recordedSnapshots: 0,
        failedSnapshots: 0,
        omittedSnapshots: 0,
        unrecordedSnapshots: 1,
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
