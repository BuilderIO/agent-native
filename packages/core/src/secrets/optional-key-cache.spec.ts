import { beforeEach, describe, expect, it } from "vitest";

import {
  invalidateOptionalKeyCache,
  readOptionalKeyCache,
  resetOptionalKeyCache,
  writeOptionalKeyCache,
} from "./optional-key-cache.js";

describe("optional key cache", () => {
  beforeEach(() => resetOptionalKeyCache());

  it("memoizes an absent optional key distinctly from a cache miss", () => {
    expect(readOptionalKeyCache("jev:user")).toEqual({ hit: false });
    writeOptionalKeyCache("jev:user", undefined);
    expect(readOptionalKeyCache("jev:user")).toEqual({
      hit: true,
      value: undefined,
    });
  });

  it("clears cached presence when a secret changes", () => {
    writeOptionalKeyCache("jev:user", "jev-test-key");
    invalidateOptionalKeyCache();
    expect(readOptionalKeyCache("jev:user")).toEqual({ hit: false });
  });
});
