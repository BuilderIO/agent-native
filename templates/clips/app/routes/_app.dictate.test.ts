import { describe, expect, it } from "vitest";

import { dictationsRefetchInterval } from "./_app.dictate";

describe("dictate list refresh", () => {
  it("keeps polling so desktop-created dictations appear without a full reload", () => {
    expect(dictationsRefetchInterval()).toBe(2_000);
  });
});
