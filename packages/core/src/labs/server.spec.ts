import { describe, expect, it, vi } from "vitest";

vi.mock("../action.js", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string) => {
    throw new Error(message);
  },
}));

const labs = await import("./server.js");

describe("labs server entry point", () => {
  it("exports the Show all and server-guard helpers", () => {
    expect(labs.assertLabEnabled).toBeTypeOf("function");
    expect(labs.getUserLabsShowAll).toBeTypeOf("function");
    expect(labs.setUserLabsShowAll).toBeTypeOf("function");
  });
});
