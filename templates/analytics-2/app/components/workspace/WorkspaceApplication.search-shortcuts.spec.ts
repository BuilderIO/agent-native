// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { shouldOpenWorkspaceSearchShortcut } from "./WorkspaceApplication";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("report M5-T2-F-12 workspace search keyboard shortcuts", () => {
  it("opens on / from Home when focus is not in an editable field", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true });
    Object.defineProperty(event, "target", { value: button });
    expect(shouldOpenWorkspaceSearchShortcut(event, "home")).toBe(true);
  });

  it.each(["project", "published-app", "code-project", "code-app"])(
    "suppresses / inside %s editing frames even when focus is on body",
    (frame) => {
      const event = new KeyboardEvent("keydown", { key: "/", bubbles: true });
      Object.defineProperty(event, "target", { value: document.body });
      expect(shouldOpenWorkspaceSearchShortcut(event, frame)).toBe(false);
    },
  );

  it("suppresses / inside an input or contenteditable on Home", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true });
    Object.defineProperty(event, "target", { value: input });
    expect(shouldOpenWorkspaceSearchShortcut(event, "home")).toBe(false);
  });

  it("opens on Mod+K inside an input on a project frame even with a closed menu in DOM", () => {
    const closedMenu = document.createElement("div");
    closedMenu.setAttribute("role", "menu");
    closedMenu.setAttribute("data-state", "closed");
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Project title");
    document.body.append(closedMenu, input);

    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
    });
    Object.defineProperty(event, "target", { value: input });
    expect(shouldOpenWorkspaceSearchShortcut(event, "project")).toBe(true);
  });

  it("blocks Mod+K when an open dialog or menu is active", () => {
    const openMenu = document.createElement("div");
    openMenu.setAttribute("role", "menu");
    openMenu.setAttribute("data-state", "open");
    document.body.append(openMenu);

    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
    });
    Object.defineProperty(event, "target", { value: document.body });
    expect(shouldOpenWorkspaceSearchShortcut(event, "project")).toBe(false);
  });
});
