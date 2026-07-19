import { describe, expect, it } from "vitest";

import {
  parseFinalizeReceipt,
  verifyFinalizeReceipt,
} from "./upload-verification";

const local = { bytes: 581_614_005, durationMs: 1_592_773 };

describe("verifyFinalizeReceipt", () => {
  it("accepts a ready receipt matching the local source", () => {
    expect(
      verifyFinalizeReceipt(
        {
          ok: true,
          finalized: true,
          status: "ready",
          sourceSizeBytes: 581_614_005,
          durationMs: 1_593_259,
        },
        local,
      ),
    ).toBe("ready");
  });

  it("accepts a durable processing receipt without treating it as ready", () => {
    expect(
      verifyFinalizeReceipt(
        {
          ok: true,
          finalized: false,
          status: "processing",
          verificationPending: true,
          sourceSizeBytes: 581_614_005,
          durationMs: 1_593_259,
        },
        local,
      ),
    ).toBe("processing");
  });

  it("rejects an HTTP-success receipt that is not finalized", () => {
    expect(() =>
      verifyFinalizeReceipt(
        {
          ok: true,
          finalized: false,
          status: "waiting_storage",
          sourceSizeBytes: 581_614_005,
          durationMs: 1_592_773,
        },
        local,
      ),
    ).toThrow(/local backup was kept/i);
  });

  it("rejects missing source bytes and materially short durations", () => {
    expect(() =>
      verifyFinalizeReceipt(
        {
          ok: true,
          finalized: true,
          status: "ready",
          durationMs: 1_592_773,
        },
        local,
      ),
    ).toThrow(/source bytes/i);

    expect(() =>
      verifyFinalizeReceipt(
        {
          ok: true,
          finalized: true,
          status: "ready",
          sourceSizeBytes: 581_614_005,
          durationMs: 483_000,
        },
        local,
      ),
    ).toThrow(/duration/i);
  });
});

describe("parseFinalizeReceipt", () => {
  it("returns structured receipts and rejects malformed successful responses", () => {
    expect(parseFinalizeReceipt('{"ok":true,"status":"ready"}')).toEqual({
      ok: true,
      status: "ready",
    });
    expect(parseFinalizeReceipt("")).toBeNull();
    expect(parseFinalizeReceipt('"ok"')).toBeNull();
    expect(() => parseFinalizeReceipt("<html>not json</html>")).toThrow(
      /invalid finalization response/i,
    );
  });
});
