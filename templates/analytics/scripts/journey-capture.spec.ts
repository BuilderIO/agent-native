import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";

import { describe, expect, it } from "vitest";

import { loadReplayEvents, requestAppResponse } from "./journey-capture";

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
