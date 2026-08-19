import { describe, expect, it } from "vitest";

import { dictationsRefetchInterval } from "./_app.dictate";

describe("dictate list refresh", () => {
  it("polls while browser dictation work is active", () => {
    expect(dictationsRefetchInterval(true)).toBe(2_000);
  });

  it("stops polling when history page is idle", () => {
    expect(dictationsRefetchInterval(false)).toBe(false);
  });
});
