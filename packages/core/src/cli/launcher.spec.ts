import { describe, expect, it } from "vitest";

// @ts-expect-error - plain JS shim helper without type declarations
import { shouldUseSourceFallback } from "../../bin/launcher.js";

const fresh = (over: Partial<Record<string, unknown>> = {}) => ({
  sourceExists: true,
  distExists: true,
  sourceMtimeMs: 1,
  distMtimeMs: 2,
  ...over,
});

describe("shouldUseSourceFallback", () => {
  it("never falls back to source in an installed package (regression guard)", () => {
    // Installed tarballs ship both src and dist, and extraction can leave .ts
    // newer than .js. Without the isSourceCheckout gate this returned true and
    // spawned tsx -> `spawn tsx ENOENT`.
    expect(
      shouldUseSourceFallback({
        isSourceCheckout: false,
        sourceEntryExists: true,
        distEntryExists: true,
        freshness: [fresh({ sourceMtimeMs: 999, distMtimeMs: 1 })],
      }),
    ).toBe(false);
  });

  it("stays on dist even when dist is missing, if not a source checkout", () => {
    expect(
      shouldUseSourceFallback({
        isSourceCheckout: false,
        sourceEntryExists: true,
        distEntryExists: false,
        freshness: [],
      }),
    ).toBe(false);
  });

  it("falls back to source when dist is missing in a source checkout", () => {
    expect(
      shouldUseSourceFallback({
        isSourceCheckout: true,
        sourceEntryExists: true,
        distEntryExists: false,
        freshness: [],
      }),
    ).toBe(true);
  });

  it("does not fall back when there is no source entry", () => {
    expect(
      shouldUseSourceFallback({
        isSourceCheckout: true,
        sourceEntryExists: false,
        distEntryExists: false,
        freshness: [],
      }),
    ).toBe(false);
  });

  it("falls back when a source file is newer than its dist output", () => {
    expect(
      shouldUseSourceFallback({
        isSourceCheckout: true,
        sourceEntryExists: true,
        distEntryExists: true,
        freshness: [fresh({ sourceMtimeMs: 10, distMtimeMs: 5 })],
      }),
    ).toBe(true);
  });

  it("uses dist when it is at least as fresh as source", () => {
    expect(
      shouldUseSourceFallback({
        isSourceCheckout: true,
        sourceEntryExists: true,
        distEntryExists: true,
        freshness: [fresh({ sourceMtimeMs: 5, distMtimeMs: 10 })],
      }),
    ).toBe(false);
  });

  it("ignores freshness pairs where a side is missing", () => {
    expect(
      shouldUseSourceFallback({
        isSourceCheckout: true,
        sourceEntryExists: true,
        distEntryExists: true,
        freshness: [
          fresh({ distExists: false, sourceMtimeMs: 999, distMtimeMs: 0 }),
        ],
      }),
    ).toBe(false);
  });
});
