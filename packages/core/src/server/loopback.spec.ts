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
});
