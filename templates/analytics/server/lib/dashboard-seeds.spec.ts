import { describe, expect, it } from "vitest";

import { isSafeDashboardId } from "./dashboard-id";
import { loadDashboardSeed } from "./dashboard-seeds";

const UNSAFE_IDS = [
  "__proto__",
  "constructor",
  "toString",
  "hasOwnProperty",
  "../../package",
  "..",
  "a/../b",
  "a/b",
  "a\\b",
  "..%2f..%2fpackage",
  "name with space",
  "ids\u0000nul",
  "",
];

describe("isSafeDashboardId", () => {
  it.each(["first-party-overview", "skills-cli-funnel", "native_v2.1", "a1"])(
    "accepts the real dashboard id %s",
    (id) => {
      expect(isSafeDashboardId(id)).toBe(true);
    },
  );

  it.each(UNSAFE_IDS)("rejects %j", (id) => {
    expect(isSafeDashboardId(id)).toBe(false);
  });
});

describe("loadDashboardSeed", () => {
  it("loads a shipped seed as a fresh copy", () => {
    const first = loadDashboardSeed("skills-cli-funnel");
    const second = loadDashboardSeed("skills-cli-funnel");

    expect(Array.isArray(first?.panels)).toBe(true);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("returns null for an id with no seed", () => {
    expect(loadDashboardSeed("no-such-dashboard")).toBeNull();
  });

  it.each(UNSAFE_IDS)(
    "returns null, never a file or a prototype member, for %j",
    (id) => {
      expect(loadDashboardSeed(id)).toBeNull();
    },
  );

  it("cannot reach a JSON file outside the seed directory", () => {
    // templates/analytics/package.json is two levels above the seed directory.
    expect(loadDashboardSeed("../../package")).toBeNull();
    expect(loadDashboardSeed("../../../analytics/package")).toBeNull();
  });
});
