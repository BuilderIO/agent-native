import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRequestIPMock = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({ getRequestIP: getRequestIPMock }));

import type { H3Event } from "h3";

import { isDirectLoopbackRequest } from "./loopback.js";

function makeEvent(
  headers: Record<string, string> = { host: "127.0.0.1:3000" },
  socket: Record<string, unknown> = {
    encrypted: false,
    localAddress: "127.0.0.1",
    remoteAddress: "127.0.0.1",
    localPort: 3000,
  },
): H3Event {
  return {
    node: { req: { headers, socket } },
  } as unknown as H3Event;
}

describe("isDirectLoopbackRequest", () => {
  beforeEach(() => {
    getRequestIPMock.mockReset().mockReturnValue("127.0.0.1");
  });

  it("accepts an unforwarded request received on the IPv4 loopback address", () => {
    expect(isDirectLoopbackRequest(makeEvent())).toBe(true);
  });

  it.each([
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-forwarded-prefix",
    "x-forwarded-proto",
  ])("rejects a loopback peer carrying %s", (header) => {
    expect(
      isDirectLoopbackRequest(
        makeEvent({ host: "127.0.0.1:3000", [header]: "spoofed" }),
      ),
    ).toBe(false);
  });

  it("requires the socket to have connected to the loopback interface", () => {
    expect(
      isDirectLoopbackRequest(
        makeEvent(undefined, {
          encrypted: false,
          localAddress: "192.168.1.10",
          remoteAddress: "127.0.0.1",
        }),
      ),
    ).toBe(false);
  });

  it("requires the literal 127.0.0.1 Host authority", () => {
    expect(isDirectLoopbackRequest(makeEvent({ host: "localhost:3000" }))).toBe(
      false,
    );
    expect(isDirectLoopbackRequest(makeEvent({ host: "127.0.0.1:0" }))).toBe(
      false,
    );
  });

  it("requires Host to name the socket's actual local port", () => {
    expect(isDirectLoopbackRequest(makeEvent({ host: "127.0.0.1:3001" }))).toBe(
      false,
    );
    expect(
      isDirectLoopbackRequest(
        makeEvent(
          { host: "127.0.0.1:3000" },
          {
            encrypted: false,
            localAddress: "127.0.0.1",
            localPort: 3000,
            remoteAddress: "203.0.113.8",
          },
        ),
      ),
    ).toBe(false);
  });

  describe("behind the dev proxy", () => {
    const proxiedSocket = {
      encrypted: false,
      localAddress: "127.0.0.1",
      remoteAddress: "127.0.0.1",
      localPort: 61586,
    };
    const optIn = { behindDevProxy: true };

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("accepts the proxy's public port in development when the caller opts in", () => {
      vi.stubEnv("NODE_ENV", "development");
      expect(
        isDirectLoopbackRequest(
          makeEvent({ host: "127.0.0.1:3000" }, proxiedSocket),
          optIn,
        ),
      ).toBe(true);
    });

    it("keeps the socket port requirement for callers that do not opt in", () => {
      vi.stubEnv("NODE_ENV", "development");
      expect(
        isDirectLoopbackRequest(
          makeEvent({ host: "127.0.0.1:3000" }, proxiedSocket),
        ),
      ).toBe(false);
    });

    it.each(["production", "test"])(
      "keeps the socket port requirement when NODE_ENV is %s",
      (nodeEnv) => {
        vi.stubEnv("NODE_ENV", nodeEnv);
        expect(
          isDirectLoopbackRequest(
            makeEvent({ host: "127.0.0.1:3000" }, proxiedSocket),
            optIn,
          ),
        ).toBe(false);
      },
    );

    it.each([
      ["a forwarded request", { host: "127.0.0.1:3000", forwarded: "for=1" }],
      ["a localhost Host", { host: "localhost:3000" }],
      ["a hostname Host", { host: "app.example.test:3000" }],
    ])("still rejects %s", (_label, headers) => {
      vi.stubEnv("NODE_ENV", "development");
      expect(
        isDirectLoopbackRequest(makeEvent(headers, proxiedSocket), optIn),
      ).toBe(false);
    });

    it("still rejects a peer that is not on the loopback interface", () => {
      vi.stubEnv("NODE_ENV", "development");
      expect(
        isDirectLoopbackRequest(
          makeEvent(
            { host: "127.0.0.1:3000" },
            { ...proxiedSocket, remoteAddress: "203.0.113.8" },
          ),
          optIn,
        ),
      ).toBe(false);
      expect(
        isDirectLoopbackRequest(
          makeEvent(
            { host: "127.0.0.1:3000" },
            { ...proxiedSocket, localAddress: "192.168.1.10" },
          ),
          optIn,
        ),
      ).toBe(false);
    });
  });
});
