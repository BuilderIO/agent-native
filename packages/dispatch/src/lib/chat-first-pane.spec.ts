import { describe, expect, it } from "vitest";

import {
  createTurnViewportLock,
  delegatedAppFromToolStart,
  visibleChatFirstSurfaceTabId,
} from "./chat-first-pane";

const mail = { id: "app:mail-2:/", kind: "app", placement: "side" } as const;
const calendar = {
  id: "app:calendar-2:/",
  kind: "app",
  placement: "side",
} as const;
const browser = { id: "browser:home", kind: "browser" } as const;

describe("visibleChatFirstSurfaceTabId", () => {
  it("shows the first side app when the main chat holds focus", () => {
    expect(visibleChatFirstSurfaceTabId([mail], null)).toBe(mail.id);
    expect(visibleChatFirstSurfaceTabId([browser, mail, calendar], null)).toBe(
      mail.id,
    );
  });

  it("keeps an explicit active tab", () => {
    expect(visibleChatFirstSurfaceTabId([mail, calendar], calendar.id)).toBe(
      calendar.id,
    );
  });

  it("shows nothing when there is no side app and no active tab", () => {
    expect(visibleChatFirstSurfaceTabId([browser], null)).toBeNull();
    expect(visibleChatFirstSurfaceTabId([], null)).toBeNull();
  });

  it("ignores an active id that no tab carries", () => {
    expect(visibleChatFirstSurfaceTabId([mail], "gone")).toBe(mail.id);
  });
});

describe("delegatedAppFromToolStart", () => {
  it("names the app a first-party delegation targets", () => {
    expect(
      delegatedAppFromToolStart({
        tool: "call-agent",
        input: { agent: "mail-2", message: "list inbox" },
      }),
    ).toBe("mail-2");
    expect(
      delegatedAppFromToolStart({
        tool: "ask_app",
        input: { app: "calendar-2", message: "week" },
      }),
    ).toBe("calendar-2");
    expect(
      delegatedAppFromToolStart({
        tool: "call_app_action",
        input: { app: "tasks-2", action: "list-issues" },
      }),
    ).toBe("tasks-2");
    expect(
      delegatedAppFromToolStart({
        tool: "list_app_actions",
        input: { app: "tasks-2" },
      }),
    ).toBe("tasks-2");
  });

  it("ignores other tools, namespaced tools, and Dispatch itself", () => {
    expect(
      delegatedAppFromToolStart({ tool: "list-events", input: { app: "x" } }),
    ).toBeNull();
    expect(
      delegatedAppFromToolStart({
        tool: "evil___call-agent",
        input: { agent: "mail-2" },
      }),
    ).toBeNull();
    expect(
      delegatedAppFromToolStart({
        tool: "call-agent",
        input: { agent: "dispatch" },
      }),
    ).toBeNull();
    expect(
      delegatedAppFromToolStart({ tool: "call-agent", input: {} }),
    ).toBeNull();
    expect(delegatedAppFromToolStart(null)).toBeNull();
    expect(
      delegatedAppFromToolStart({
        tool: "call-agent",
        input: { agent: "https://example.com/agent" },
      }),
    ).toBeNull();
    expect(
      delegatedAppFromToolStart({
        tool: "ask_app",
        input: {
          app: "content-2",
          message: "lookup notes",
          viewportMode: "background",
        },
      }),
    ).toBeNull();
    expect(
      delegatedAppFromToolStart({
        tool: "call_app_action",
        input: {
          app: "content-2",
          action: "search-docs",
          viewportMode: "background",
        },
      }),
    ).toBeNull();
  });
});

describe("createTurnViewportLock", () => {
  it("locks the foreground app for the turn and blocks secondary lookups without focus: true", () => {
    const lock = createTurnViewportLock();
    lock.beginTurn("turn-1");

    expect(
      lock.evaluate({ appId: "meeting-notes-2", turnKey: "turn-1" }),
    ).toEqual({
      allowed: true,
      lockedAppId: "meeting-notes-2",
    });

    expect(
      lock.evaluate({ appId: "meeting-notes-2", turnKey: "turn-1" }),
    ).toEqual({
      allowed: true,
      lockedAppId: "meeting-notes-2",
    });

    expect(lock.evaluate({ appId: "content-2", turnKey: "turn-1" })).toEqual({
      allowed: false,
      lockedAppId: "meeting-notes-2",
    });

    expect(
      lock.evaluate({
        appId: "content-2",
        focus: true,
        viewportMode: "background",
        turnKey: "turn-1",
      }),
    ).toEqual({
      allowed: false,
      lockedAppId: "meeting-notes-2",
    });

    expect(
      lock.evaluate({ appId: "content-2", focus: true, turnKey: "turn-1" }),
    ).toEqual({
      allowed: true,
      lockedAppId: "content-2",
    });

    expect(lock.evaluate({ appId: "decks-2", turnKey: "turn-2" })).toEqual({
      allowed: true,
      lockedAppId: "decks-2",
    });
  });
});
