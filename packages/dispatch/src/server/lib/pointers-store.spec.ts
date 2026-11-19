import { describe, expect, it } from "vitest";

import { matchPointer, normalizeAlias, pointerPath } from "./pointers-store.js";

const pointer = (alias: string, scope: "user" | "org" = "user") => ({
  alias,
  appId: "content",
  url: "u",
  scope,
});

describe("pointer matching", () => {
  it("normalizes aliases", () => {
    expect(normalizeAlias("My To-Do Lists")).toEqual(["to", "do", "list"]);
    expect(pointerPath("my todo list")).toBe("pointers/todo-list.json");
  });

  it("matches an alias inside a request, singular or plural", () => {
    const list = [pointer("todo list")];
    expect(matchPointer("whats on my todo list", list)).toBe(list[0]);
    expect(matchPointer("show my todo lists", list)).toBe(list[0]);
    expect(matchPointer("what is on my calendar", list)).toBeNull();
  });

  it("prefers the longest alias, then the personal pointer", () => {
    const [short, long, org, user] = [
      pointer("list"),
      pointer("todo list"),
      pointer("reading list", "org"),
      pointer("reading list", "user"),
    ];
    expect(matchPointer("open my todo list", [short, long])).toBe(long);
    expect(matchPointer("my reading list", [org, user])).toBe(user);
  });
});
