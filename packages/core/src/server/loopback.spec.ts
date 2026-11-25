import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRequestIPMock = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({ getRequestIP: getRequestIPMock }));

import type { H3Event } from "h3";

import {
  isDirectLoopbackRequest,
  isLoopbackPeerRequest,
  isLoopbackRequest,
} from "./loopback.js";

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
    vi.stubEnv("FUSION_ENVIRONMENT", "");
    vi.stubEnv("FUSION_POD_UID", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

describe("isLoopbackRequest", () => {
  beforeEach(() => {
    getRequestIPMock.mockReset().mockReturnValue("127.0.0.1");
    vi.stubEnv("FUSION_ENVIRONMENT", "");
    vi.stubEnv("FUSION_POD_UID", "");
    vi.stubEnv("AGENT_NATIVE_ALLOW_BUILDER_PREVIEW_LOCAL_DEV", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    { host: "localhost:8080" },
    { host: "127.0.0.1:3000" },
    { host: "[::1]:3000" },
    { host: "app.localhost:8080" },
    {
      host: "127.0.0.1:3001",
      "x-forwarded-host": "localhost:8080",
      "x-forwarded-for": "127.0.0.1, ::1",
      "x-forwarded-proto": "http",
    },
    { host: "localhost", forwarded: 'for="[::1]:51234";host=localhost:8080' },
  ])("accepts a local request %j", (headers) => {
    expect(isLoopbackRequest(makeEvent(headers))).toBe(true);
  });

  it.each([
    { host: "localhost:8080", "x-forwarded-for": "203.0.113.7" },
    { host: "localhost:8080", "x-forwarded-for": "127.0.0.1, 203.0.113.7" },
    { host: "localhost:8080", "x-forwarded-host": "preview.example.dev" },
    { host: "localhost:8080", forwarded: "for=203.0.113.7" },
    { host: "localhost:8080", forwarded: "host=preview.example.dev" },
    { host: "localhost:8080", "x-real-ip": "203.0.113.7" },
    { host: "preview.example.dev" },
    { host: "localhost.example.dev" },
    { host: "127.attacker.example" },
    { host: "127.0.0.1.attacker.example:3000" },
    { host: "127.0.0.256" },
    { host: "localhost:8080", "x-forwarded-for": "127.attacker.example" },
    { host: "[::1]attacker.example" },
    { host: "127.0.0.1:bad" },
    { host: "localhost:8080:8080" },
    { host: "user@localhost" },
    { host: "localhost:8080", "x-forwarded-host": "[::1]attacker.example" },
    { host: "localhost:8080", "x-forwarded-host": "127.0.0.1:bad" },
    { host: "localhost:8080", forwarded: 'for="[::1]attacker.example"' },
    { host: "localhost:8080", "cf-connecting-ip": "203.0.113.7" },
    { host: "localhost:8080", "true-client-ip": "203.0.113.7" },
    { host: "localhost:8080", "fly-client-ip": "203.0.113.7" },
    { host: "localhost:8080", "x-client-ip": "203.0.113.7" },
    { host: "localhost:8080", "x-original-host": "preview.example.dev" },
    { host: "localhost:8080", "x-host": "preview.example.dev" },
    {},
  ])("refuses a proxied or foreign-host request %j", (headers) => {
    expect(isLoopbackPeerRequest(makeEvent(headers))).toBe(false);
    expect(isLoopbackRequest(makeEvent(headers))).toBe(false);
  });

  it("reads the authority from the URL of an in-process request without a Host header", () => {
    const webEvent = (url: string) =>
      ({ req: { url, headers: new Headers() } }) as unknown as H3Event;
    expect(isLoopbackRequest(webEvent("http://localhost:3000/x"))).toBe(true);
    expect(isLoopbackRequest(webEvent("http://preview.example.dev/x"))).toBe(
      false,
    );
  });

  it("refuses a remote socket peer", () => {
    getRequestIPMock.mockReturnValue("203.0.113.7");
    expect(isLoopbackRequest(makeEvent({ host: "localhost:8080" }))).toBe(
      false,
    );
  });

  it.each([
    ["FUSION_ENVIRONMENT", "cloud"],
    ["FUSION_ENVIRONMENT", "cloud-v2"],
    ["FUSION_POD_UID", "pod-uid"],
  ])(
    "does not trust loopback inside a public dev container (%s=%s)",
    (name, value) => {
      vi.stubEnv(name, value);
      const event = makeEvent({ host: "localhost:8080" });
      expect(isLoopbackPeerRequest(event)).toBe(true);
      expect(isLoopbackRequest(event)).toBe(false);

      vi.stubEnv("AGENT_NATIVE_ALLOW_BUILDER_PREVIEW_LOCAL_DEV", "1");
      expect(isLoopbackRequest(event)).toBe(true);
    },
  );

  it("ignores the container opt-in outside development", () => {
    vi.stubEnv("FUSION_ENVIRONMENT", "cloud");
    vi.stubEnv("AGENT_NATIVE_ALLOW_BUILDER_PREVIEW_LOCAL_DEV", "1");
    const event = makeEvent({ host: "localhost:8080" });
    expect(isLoopbackRequest(event)).toBe(true);

    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "production");
    expect(isLoopbackRequest(event)).toBe(false);

    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(isLoopbackRequest(event)).toBe(false);
  });
});
