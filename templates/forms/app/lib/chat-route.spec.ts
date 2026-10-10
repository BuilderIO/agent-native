import { describe, expect, it } from "vitest";

import { formsAskThreadPath, isFormsAskPath } from "./chat-route";

describe("forms ask route paths", () => {
  it("treats the create route and every thread route as the ask page", () => {
    expect(isFormsAskPath("/ask")).toBe(true);
    expect(isFormsAskPath("/ask/")).toBe(true);
    expect(isFormsAskPath("/ask/thread-1")).toBe(true);
    expect(isFormsAskPath("/asking")).toBe(false);
    expect(isFormsAskPath("/forms")).toBe(false);
  });

  it("builds the create path and encoded thread paths", () => {
    expect(formsAskThreadPath(null)).toBe("/ask");
    expect(formsAskThreadPath("a b")).toBe("/ask/a%20b");
  });
});
