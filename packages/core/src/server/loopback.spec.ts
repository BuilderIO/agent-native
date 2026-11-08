import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("accepts an in-process Web Request marked directLoopback on http://127.0.0.1", () => {
    const req = new Request(
      "http://127.0.0.1:3000/_agent-native/actions/get-chatgpt-subscription-status",
    ) as Request & { context?: Record<string, unknown> };
    req.context = { clientAddress: "127.0.0.1", directLoopback: true };
    expect(isDirectLoopbackRequest({ req } as unknown as H3Event)).toBe(true);
  });

  it("rejects an in-process Web Request without directLoopback, with forwarded headers, or on non-127.0.0.1 origins", () => {
    const withoutFlag = new Request(
      "http://127.0.0.1:3000/_agent-native/actions/get-chatgpt-subscription-status",
    ) as Request & { context?: Record<string, unknown> };
    withoutFlag.context = { clientAddress: "127.0.0.1" };
    expect(
      isDirectLoopbackRequest({ req: withoutFlag } as unknown as H3Event),
    ).toBe(false);

    const localhostReq = new Request(
      "http://localhost:3000/_agent-native/actions/get-chatgpt-subscription-status",
    ) as Request & { context?: Record<string, unknown> };
    localhostReq.context = { clientAddress: "127.0.0.1", directLoopback: true };
    expect(
      isDirectLoopbackRequest({ req: localhostReq } as unknown as H3Event),
    ).toBe(false);

    const forwardedReq = new Request(
      "http://127.0.0.1:3000/_agent-native/actions/get-chatgpt-subscription-status",
      { headers: { "x-forwarded-host": "evil.example.com" } },
    ) as Request & { context?: Record<string, unknown> };
    forwardedReq.context = { clientAddress: "127.0.0.1", directLoopback: true };
    expect(
      isDirectLoopbackRequest({ req: forwardedReq } as unknown as H3Event),
    ).toBe(false);
  });
});
