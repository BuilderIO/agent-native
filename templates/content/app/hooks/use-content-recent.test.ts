import { describe, expect, it } from "vitest";

import {
  contentRecentQueryArgs,
  isContentRecentContextChanged,
} from "./use-content-recent";

describe("contentRecentQueryArgs", () => {
  it("never serializes an empty optional space ID", () => {
    expect(contentRecentQueryArgs(undefined, undefined)).toBeUndefined();
    expect(contentRecentQueryArgs("scope", undefined)).toEqual({
      scopeKey: "scope",
    });
    expect(contentRecentQueryArgs("scope", "")).toEqual({ scopeKey: "scope" });
    expect(contentRecentQueryArgs("scope", "space-1")).toEqual({
      scopeKey: "scope",
      spaceId: "space-1",
    });
  });
});

describe("isContentRecentContextChanged", () => {
  it("recognizes only the server's stale-navigation-scope response", () => {
    expect(
      isContentRecentContextChanged(
        Object.assign(new Error("Navigation context changed."), {
          errorCode: "context_changed",
        }),
      ),
    ).toBe(true);
    expect(
      isContentRecentContextChanged(
        Object.assign(new Error(), { status: 409 }),
      ),
    ).toBe(false);
    expect(isContentRecentContextChanged(new Error("failed"))).toBe(false);
  });
});
