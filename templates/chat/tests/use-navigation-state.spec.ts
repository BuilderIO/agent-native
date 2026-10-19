import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
