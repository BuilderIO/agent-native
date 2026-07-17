import { describe, expect, it } from "vitest";

import { verifyFinalizeReceipt } from "./upload-verification";

const local = { bytes: 581_614_005, durationMs: 1_592_773 };

describe("verifyFinalizeReceipt", () => {
  it("accepts a ready receipt matching the local source", () => {
    expect(() =>
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
    ).not.toThrow();
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
