import { describe, expect, it } from "vitest";

import {
  navigationStateForPath,
  pathForCommand,
} from "../app/hooks/use-navigation-state";

describe("navigationStateForPath", () => {
  it("names the view and ids for each route", () => {
    expect(navigationStateForPath("/").view).toBe("home");
    expect(navigationStateForPath("/workspaces/w1")).toMatchObject({
      view: "workspace",
      workspaceId: "w1",
    });
    expect(navigationStateForPath("/forms/f1")).toMatchObject({
      view: "form",
      formId: "f1",
      tab: "insights",
    });
    expect(navigationStateForPath("/forms/f1/submissions")).toMatchObject({
      view: "form",
      tab: "submissions",
    });
    expect(navigationStateForPath("/forms/f1/edit")).toMatchObject({
      view: "editor",
      tab: "edit",
    });
    expect(navigationStateForPath("/settings/agent").view).toBe("agent");
  });
});

describe("pathForCommand", () => {
  it("builds a path from a view and ids", () => {
    expect(pathForCommand({ view: "home" })).toBe("/");
    expect(pathForCommand({ view: "workspace", workspaceId: "w1" })).toBe(
      "/workspaces/w1",
    );
    expect(pathForCommand({ view: "editor", formId: "f1" })).toBe(
      "/forms/f1/edit",
    );
    expect(pathForCommand({ view: "form", formId: "f1", tab: "share" })).toBe(
      "/forms/f1/share",
    );
    expect(pathForCommand({ view: "form", formId: "f1" })).toBe("/forms/f1");
  });
});
