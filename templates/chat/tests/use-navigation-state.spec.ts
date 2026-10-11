import { describe, expect, it } from "vitest";

import { pathForCommand } from "../app/hooks/use-navigation-state";

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
