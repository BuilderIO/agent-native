import { describe, expect, it } from "vitest";

import { buildNavigatePath, pathForView, viewForPath } from "./navigation.js";

describe("shared navigation", () => {
  it("maps paths to views", () => {
    expect(viewForPath("/tasks")).toBe("tasks");
    expect(viewForPath("/inbox")).toBe("inbox");
    expect(viewForPath("/")).toBe("tasks");
  });

  it("maps views and aliases to paths", () => {
    expect(pathForView("tasks")).toBe("/tasks");
    expect(pathForView("inbox")).toBe("/inbox");
    expect(pathForView("home")).toBe("/tasks");
    expect(pathForView("ask")).toBe("/tasks");
  });

  it("builds task list URLs with filter and selection", () => {
    expect(buildNavigatePath("/tasks", {})).toBe("/tasks");
    expect(buildNavigatePath("/tasks", { includeDone: true })).toBe(
      "/tasks?includeDone=true",
    );
    expect(
      buildNavigatePath("/tasks", { taskId: "abc", includeDone: true }),
    ).toBe("/tasks?task=abc&includeDone=true");
  });

  it("preserves the show-completed filter when navigating within tasks", () => {
    expect(
      buildNavigatePath("/tasks", { taskId: "abc" }, { includeDone: true }),
    ).toBe("/tasks?task=abc&includeDone=true");
    expect(
      buildNavigatePath("/tasks", { taskId: "abc" }, { includeDone: false }),
    ).toBe("/tasks?task=abc");
    expect(
      buildNavigatePath(
        "/inbox",
        { inboxItemId: "in-1" },
        { includeDone: true },
      ),
    ).toBe("/inbox?inboxItem=in-1");
  });

  it("honors an explicit includeDone=false over the current filter", () => {
    expect(
      buildNavigatePath(
        "/tasks",
        { taskId: "abc", includeDone: false },
        { includeDone: true },
      ),
    ).toBe("/tasks?task=abc");
  });

  it("builds inbox URLs with selection", () => {
    expect(buildNavigatePath("/inbox", {})).toBe("/inbox");
    expect(buildNavigatePath("/inbox", { inboxItemId: "in-1" })).toBe(
      "/inbox?inboxItem=in-1",
    );
  });
});
