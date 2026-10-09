import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  captureBrowserRecording,
  loadReplayEvents,
  preparePrivateOutputDirectory,
  requestAppResponse,
  writePromptProvenanceSidecar,
  type Browser,
  type BrowserContext,
  type BrowserPage,
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
    const frameUrl = `http://127.0.0.1:${port}/sessions/sr_1?agent_access=scoped-grant&frame=1`;

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
      const sidecar = await readFile(sidecarPath, "utf8");
      expect((await stat(sidecarPath)).mode & 0o777).toBe(0o600);
      expect(sidecar).toContain('"treeSourceEventAt": "source-event-one"');
      expect(sidecar).toContain('"requestedOffsetMs": 10');
      expect(sidecar).toContain('"observedOffsetMs": 10');
      expect(sidecar).toContain('"playheadOffsetMs": 5');
      expect(sidecar).toContain('"unrecordedSnapshots": 0');
      expect(sidecar).toContain("[REDACTED]");
      expect(sidecar).not.toContain("example-secret");
      expect(sidecar).not.toContain("attemptId");
    } finally {
      await close(appServer);
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

describe("prompt provenance sidecar", () => {
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
