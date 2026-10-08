import { createServer } from "node:http";
import type { Server } from "node:http";

import { describe, expect, it } from "vitest";

import { requestAppResponse } from "./journey-capture";

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
