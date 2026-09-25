import { describe, expect, it } from "vitest";

import {
  parseSavedDraftBackend,
  resolveSavedDraftBackend,
} from "./draft-backend";

describe("saved draft backend", () => {
  it("keeps an explicit local draft local after Gmail is connected", () => {
    expect(resolveSavedDraftBackend("local", true)).toBe("local");
  });

  it("keeps an explicit Gmail draft on Gmail and leaves disconnect handling to the caller", () => {
    expect(resolveSavedDraftBackend("gmail", false)).toBe("gmail");
  });

  it("chooses the connected backend for a new draft", () => {
    expect(resolveSavedDraftBackend(undefined, true)).toBe("gmail");
    expect(resolveSavedDraftBackend(undefined, false)).toBe("local");
  });

  it("rejects unknown backend metadata instead of silently changing backends", () => {
    expect(() => parseSavedDraftBackend("other")).toThrow(
      "Invalid saved draft backend",
    );
  });
});
