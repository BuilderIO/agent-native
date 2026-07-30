import { describe, expect, it } from "vitest";

import {
  describeRenderVerification,
  isRenderVerified,
  resolveRenderVerification,
} from "./render-verification";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);

describe("render verification state", () => {
  it("reports a passing stamp for the same content as verified", () => {
    const state = resolveRenderVerification({
      contentHash: HASH,
      row: {
        verifiedRenderHash: HASH,
        verifiedRenderStatus: "pass",
        verifiedRenderAt: "2026-07-30T00:00:00.000Z",
      },
    });
    expect(state).toEqual({
      state: "verified",
      at: "2026-07-30T00:00:00.000Z",
    });
    expect(isRenderVerified(state)).toBe(true);
  });

  it("does not carry a pass across an edit", () => {
    // The whole point of hashing: nobody has to remember to clear the stamp.
    const state = resolveRenderVerification({
      contentHash: OTHER,
      row: { verifiedRenderHash: HASH, verifiedRenderStatus: "pass" },
    });
    expect(state).toEqual({ state: "stale" });
    expect(isRenderVerified(state)).toBe(false);
  });

  it("keeps a missing browser distinct from a pass", () => {
    const state = resolveRenderVerification({
      contentHash: HASH,
      row: {
        verifiedRenderHash: HASH,
        verifiedRenderStatus: "unavailable",
        verifiedRenderAt: "2026-07-30T00:00:00.000Z",
        verifiedRenderFindings: JSON.stringify([
          { kind: "page-error", message: "no Chromium binary" },
        ]),
      },
    });
    expect(state.state).toBe("unavailable");
    expect(isRenderVerified(state)).toBe(false);
    expect(describeRenderVerification(state)).toMatch(/not a pass/);
  });

  it("returns findings only for the content they describe", () => {
    const row = {
      verifiedRenderHash: HASH,
      verifiedRenderStatus: "fail",
      verifiedRenderAt: "2026-07-30T00:00:00.000Z",
      verifiedRenderFindings: JSON.stringify([
        { kind: "alpine-expression", message: "Invalid or unexpected token" },
      ]),
    };
    const current = resolveRenderVerification({ contentHash: HASH, row });
    expect(current).toMatchObject({ state: "failed" });
    expect(current).toHaveProperty("findings.0.message");

    const edited = resolveRenderVerification({ contentHash: OTHER, row });
    expect(edited).toEqual({ state: "stale" });
    expect(edited).not.toHaveProperty("findings");
  });

  it.each([
    ["no stamp", {}],
    ["hash without status", { verifiedRenderHash: HASH }],
    ["status without hash", { verifiedRenderStatus: "pass" }],
  ])("treats %s as never verified", (_label, row) => {
    expect(resolveRenderVerification({ contentHash: HASH, row })).toEqual({
      state: "never",
    });
  });

  it("refuses to read an unrecognized status as a pass", () => {
    expect(
      resolveRenderVerification({
        contentHash: HASH,
        row: { verifiedRenderHash: HASH, verifiedRenderStatus: "ok" },
      }),
    ).toEqual({ state: "stale" });
  });

  it("survives an unreadable findings blob without claiming success", () => {
    const state = resolveRenderVerification({
      contentHash: HASH,
      row: {
        verifiedRenderHash: HASH,
        verifiedRenderStatus: "fail",
        verifiedRenderAt: "2026-07-30T00:00:00.000Z",
        verifiedRenderFindings: "{not json",
      },
    });
    expect(state).toMatchObject({ state: "failed", findings: [] });
    expect(isRenderVerified(state)).toBe(false);
  });
});
