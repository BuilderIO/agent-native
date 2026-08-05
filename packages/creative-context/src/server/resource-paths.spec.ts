import { describe, expect, it } from "vitest";

import { getCreativeContextResourcePath } from "./resource-paths.js";

describe("creative context shareable resource paths", () => {
  it("opens the Library tab exposed by each app", () => {
    expect(getCreativeContextResourcePath()).toBe("/agent#library");
  });
});
