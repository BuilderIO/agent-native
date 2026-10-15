import { describe, expect, it } from "vitest";

import { dictationsRefetchInterval, withoutDictation } from "./_app.dictate";

describe("dictate list refresh", () => {
  it("polls while browser dictation work is active", () => {
    expect(dictationsRefetchInterval(true)).toBe(2_000);
  });

  it("stops polling when history page is idle", () => {
    expect(dictationsRefetchInterval(false)).toBe(false);
  });

  it("drops a deleted dictation from either cached list shape", () => {
    const a = { id: "a" } as any;
    const b = { id: "b" } as any;
    expect(withoutDictation([a, b], "a")).toEqual([b]);
    expect(withoutDictation({ dictations: [a, b] }, "b")).toEqual({
      dictations: [a],
    });
    expect(withoutDictation(undefined, "a")).toBeUndefined();
  });
});
