import { describe, expect, it } from "vitest";

import {
  MAX_REPLAY_QUOTA_PAUSE_MS,
  decideReplayQuotaResponse,
  parseRetryAfterSeconds,
} from "./session-replay-quota.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");

describe("parseRetryAfterSeconds", () => {
  it("reads delta-seconds", () => {
    expect(parseRetryAfterSeconds("60", NOW)).toBe(60);
    expect(parseRetryAfterSeconds("  0 ", NOW)).toBe(0);
  });

  it("reads an HTTP-date as a delta from now", () => {
    expect(parseRetryAfterSeconds("Thu, 01 Jan 2026 00:02:00 GMT", NOW)).toBe(
      120,
    );
  });

  it("clamps a past HTTP-date to zero rather than going negative", () => {
    expect(parseRetryAfterSeconds("Wed, 31 Dec 2025 23:00:00 GMT", NOW)).toBe(
      0,
    );
  });

  it("separates 'the server did not say' from a zero-second wait", () => {
    expect(parseRetryAfterSeconds(undefined, NOW)).toBeNull();
    expect(parseRetryAfterSeconds(null, NOW)).toBeNull();
    expect(parseRetryAfterSeconds("", NOW)).toBeNull();
    expect(parseRetryAfterSeconds("soon", NOW)).toBeNull();
    expect(parseRetryAfterSeconds("-5", NOW)).toBeNull();
  });
});

describe("decideReplayQuotaResponse", () => {
  it("stops when the server named no retry window", () => {
    expect(decideReplayQuotaResponse(null, NOW)).toEqual({ kind: "stop" });
    expect(decideReplayQuotaResponse(undefined, NOW)).toEqual({ kind: "stop" });
  });

  it("pauses for a short rate-limit window", () => {
    expect(decideReplayQuotaResponse(60, NOW)).toEqual({
      kind: "pause",
      resumeAtMs: NOW + 60_000,
    });
  });

  it("pauses at the boundary and stops past it", () => {
    const boundarySeconds = MAX_REPLAY_QUOTA_PAUSE_MS / 1000;
    expect(decideReplayQuotaResponse(boundarySeconds, NOW).kind).toBe("pause");
    expect(decideReplayQuotaResponse(boundarySeconds + 1, NOW)).toEqual({
      kind: "stop",
    });
  });

  it("stops for a day-long byte quota window", () => {
    expect(decideReplayQuotaResponse(24 * 60 * 60, NOW)).toEqual({
      kind: "stop",
    });
  });
});
