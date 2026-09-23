import { describe, expect, it } from "vitest";

import { contentRecentQueryArgs } from "./use-content-recent";

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
