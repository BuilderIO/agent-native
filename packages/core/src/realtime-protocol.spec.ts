import { describe, expect, it } from "vitest";

import {
  buildHandshakeFrame,
  parseHandshakeFrame,
  parseTokenFrame,
  REALTIME_CAP_NO_AWARENESS,
  REALTIME_PROTOCOL_VERSION,
} from "./realtime-protocol.js";

describe("realtime-protocol", () => {
  it("round-trips a handshake frame", () => {
    const frame = buildHandshakeFrame([REALTIME_CAP_NO_AWARENESS]);
    expect(frame).toEqual({
      protocol: REALTIME_PROTOCOL_VERSION,
      capabilities: [REALTIME_CAP_NO_AWARENESS],
    });
    expect(parseHandshakeFrame(JSON.stringify(frame))).toEqual(frame);
  });

  it("defaults handshake capabilities to empty", () => {
    expect(buildHandshakeFrame().capabilities).toEqual([]);
  });

  it("drops non-string capabilities defensively", () => {
    const parsed = parseHandshakeFrame(
      JSON.stringify({ protocol: 1, capabilities: ["no-awareness", 42, null] }),
    );
    expect(parsed?.capabilities).toEqual(["no-awareness"]);
  });

  it("returns null for malformed handshake payloads", () => {
    expect(parseHandshakeFrame("not json")).toBeNull();
    expect(parseHandshakeFrame(JSON.stringify({ protocol: "1" }))).toBeNull();
    expect(
      parseHandshakeFrame(JSON.stringify({ capabilities: [] })),
    ).toBeNull();
  });

  it("parses a token frame with optional expiry", () => {
    expect(parseTokenFrame(JSON.stringify({ token: "abc" }))).toEqual({
      token: "abc",
      expiresAt: undefined,
    });
    expect(
      parseTokenFrame(
        JSON.stringify({ token: "abc", expiresAt: "2026-01-01" }),
      ),
    ).toEqual({ token: "abc", expiresAt: "2026-01-01" });
  });

  it("returns null for a token frame missing the token", () => {
    expect(parseTokenFrame(JSON.stringify({ expiresAt: "x" }))).toBeNull();
    expect(parseTokenFrame("{")).toBeNull();
  });
});
