import { describe, expect, it } from "vitest";

import { isPlanChatPath, planChatThreadPath } from "./chat-route";

describe("plan chat route paths", () => {
  it("treats the create route and every thread route as the chat page", () => {
    expect(isPlanChatPath("/chat")).toBe(true);
    expect(isPlanChatPath("/chat/")).toBe(true);
    expect(isPlanChatPath("/chat/thread-1")).toBe(true);
    expect(isPlanChatPath("/chatty")).toBe(false);
    expect(isPlanChatPath("/plans")).toBe(false);
  });

  it("builds the create path and encoded thread paths", () => {
    expect(planChatThreadPath(null)).toBe("/chat");
    expect(planChatThreadPath("a b")).toBe("/chat/a%20b");
  });
});
