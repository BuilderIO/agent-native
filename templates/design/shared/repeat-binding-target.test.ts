import { describe, expect, it } from "vitest";
import { repeatBindingTarget, repeatItemVariable } from "./repeat-data";

describe("which part of an item a binding writes", () => {
  it("names the field for a member read", () => {
    expect(repeatBindingTarget("todo.text", "todo")).toEqual({
      kind: "field",
      field: "text",
    });
  });

  it("names the whole item for a bare variable", () => {
    expect(repeatBindingTarget("value", "value")).toEqual({ kind: "item" });
  });

  it("refuses a computed expression rather than guessing", () => {
    expect(repeatBindingTarget("todo.done ? 'a' : 'b'", "todo")).toBeNull();
    expect(repeatBindingTarget("todo.text.toUpperCase()", "todo")).toBeNull();
    expect(repeatBindingTarget("other.text", "todo")).toBeNull();
    expect(repeatBindingTarget("todo.a.b", "todo")).toBeNull();
  });

  it("reads the item variable out of both x-for shapes", () => {
    expect(repeatItemVariable("todo in todos")).toBe("todo");
    expect(repeatItemVariable("(value, index) in barValues")).toBe("value");
  });
});
