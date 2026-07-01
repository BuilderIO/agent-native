import { describe, expect, it } from "vitest";

import { builderSourceRowFetchStatus } from "./DatabaseView";

describe("Builder source row fetch status", () => {
  it("shows background refresh errors before stale partial progress", () => {
    expect(
      builderSourceRowFetchStatus({
        metadata: {
          primaryKey: "id",
          titleField: "data.title",
          sourceFetchState: "error",
          lastReadPartial: true,
        },
      }),
    ).toBe("error");
  });

  it("shows partial live reads as still fetching", () => {
    expect(
      builderSourceRowFetchStatus({
        metadata: {
          primaryKey: "id",
          titleField: "data.title",
          sourceFetchState: "idle",
          lastReadPartial: true,
        },
      }),
    ).toBe("fetching");
  });
});
