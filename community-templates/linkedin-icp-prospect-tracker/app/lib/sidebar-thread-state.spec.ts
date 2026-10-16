import { describe, expect, it } from "vitest";

import { optimisticStartedThreads } from "./sidebar-thread-state";

describe("optimisticStartedThreads", () => {
  it("keeps starts the lifecycle has not observed yet", () => {
    const threads = [
      {
        id: "known",
        title: "Known",
        preview: "",
        messageCount: 0,
        createdAt: 1,
        updatedAt: 1,
        scope: null,
      },
    ];

    expect(
      optimisticStartedThreads(
        threads,
        new Map([
          ["known", 1],
          ["new", 2],
        ]),
      ),
    ).toEqual(new Map([["new", 2]]));
  });

  it("keeps an empty map empty", () => {
    expect(optimisticStartedThreads([], new Map())).toEqual(new Map());
  });
});
