import { describe, expect, it } from "vitest";

import { copyName } from "./duplicate-form.js";

describe("copyName", () => {
  it("names the copy after the original", () => {
    expect(copyName("Contact us")).toBe("Contact us copy");
  });

  it("numbers a copy of a copy", () => {
    expect(copyName("Contact us copy")).toBe("Contact us copy 2");
    expect(copyName("Contact us copy 2")).toBe("Contact us copy 3");
  });

  it("keeps an untitled form sayable", () => {
    expect(copyName("   ")).toBe("copy");
  });
});
