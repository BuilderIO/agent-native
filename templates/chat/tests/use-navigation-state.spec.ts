import { afterEach, describe, expect, it, vi } from "vitest";

import {
  commandPathForNavigation,
  navigationStateForPath,
  pathForCommand,
} from "../app/hooks/use-navigation-state";

describe("pathForCommand", () => {
  it("keeps explicit home navigation at /home when a thread id is present", () => {
    expect(pathForCommand({ view: "home", threadId: "thread-one" })).toBe(
      "/home",
    );
  });

  it("uses a thread id only for chat views", () => {
    expect(pathForCommand({ view: "chat", threadId: "thread-one" })).toBe(
      "/chat/thread-one",
    );
    expect(pathForCommand({ view: "ask", threadId: "thread-one" })).toBe(
      "/chat/thread-one",
    );
    expect(pathForCommand({ view: "chat" })).toBe("/chat");
  });
});

describe("navigationStateForPath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps the router path local and records the mounted public path", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/chat");
    vi.stubGlobal("window", {
      location: { pathname: "/chat/chat/thread-one" },
    });

    expect(navigationStateForPath("/chat/thread-one")).toEqual({
      view: "chat",
      path: "/chat/thread-one",
      publicPath: "/chat/chat/thread-one",
      threadId: "thread-one",
    });
  });
});

describe("commandPathForNavigation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("converts public mounted chat paths back to router-local paths", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/chat");
    vi.stubGlobal("window", {
      location: { pathname: "/chat/chat/thread-one" },
    });

    expect(
      commandPathForNavigation({
        view: "chat",
        path: "/chat/chat/thread-one",
      }),
    ).toBe("/chat/thread-one");
  });

  it("preserves query and hash suffixes when normalizing mounted paths", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/chat");
    vi.stubGlobal("window", {
      location: { pathname: "/chat/settings/app" },
    });

    expect(
      commandPathForNavigation({
        view: "settings",
        path: "/chat/settings/app?tab=members#invite",
      }),
    ).toBe("/settings/app?tab=members#invite");
  });

  it("normalizes an explicit public path when no view is provided", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/chat");
    vi.stubGlobal("window", {
      location: { pathname: "/chat/chat/thread-one" },
    });

    expect(
      commandPathForNavigation({
        path: "/chat/rooms/123?week=2026-10-05",
        publicPath: "/chat/rooms/123",
      }),
    ).toBe("/rooms/123?week=2026-10-05");
  });

  it("preserves declared paths outside the app mount prefix", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/chat");
    vi.stubGlobal("window", {
      location: { pathname: "/chat/settings" },
    });

    expect(
      commandPathForNavigation({
        view: "settings",
        path: "/settings",
        publicPath: "/settings",
      }),
    ).toBe("/settings");
  });

  it("preserves path-only local chat routes under the mount prefix", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/chat");
    vi.stubGlobal("window", {
      location: { pathname: "/chat/chat/thread-one" },
    });

    expect(commandPathForNavigation({ path: "/chat/thread-one" })).toBe(
      "/chat/thread-one",
    );
  });

  it("preserves router-local chat paths and their query strings", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/chat");
    vi.stubGlobal("window", {
      location: { pathname: "/chat/chat/thread-one" },
    });

    expect(
      commandPathForNavigation({
        view: "chat",
        path: "/chat/thread-one?tab=activity#latest",
      }),
    ).toBe("/chat/thread-one?tab=activity#latest");
  });

  it("normalizes public mounted paths when the local route uses another view", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/chat");
    vi.stubGlobal("window", {
      location: { pathname: "/chat/settings/app" },
    });

    expect(
      commandPathForNavigation({
        view: "settings",
        path: "/chat/settings/app",
      }),
    ).toBe("/settings/app");
  });

  it("preserves local chat paths and semantic fallbacks", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/chat");
    vi.stubGlobal("window", {
      location: { pathname: "/chat/chat/thread-one" },
    });

    expect(
      commandPathForNavigation({ view: "chat", path: "/chat/thread-one" }),
    ).toBe("/chat/thread-one");
    expect(
      commandPathForNavigation({ view: "chat", threadId: "thread-one" }),
    ).toBe("/chat/thread-one");
  });
});
