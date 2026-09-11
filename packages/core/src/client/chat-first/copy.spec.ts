import { describe, expect, it } from "vitest";

import { defaultChatFirstCopy } from "./copy.js";

describe("default chat-first copy", () => {
  it("provides labels used by the primary navigation", () => {
    expect(defaultChatFirstCopy("newChat")).toBe("New chat");
    expect(defaultChatFirstCopy("search")).toBe("Search");
  });

  it("provides a clear destructive app action label", () => {
    expect(defaultChatFirstCopy("removeApp")).toBe("Remove app from workspace");
  });

  it("keeps app pin labels independent of the app name", () => {
    expect(defaultChatFirstCopy("pinApp", { name: "Long app name" })).toBe(
      "Pin this app",
    );
    expect(defaultChatFirstCopy("unpinApp", { name: "Long app name" })).toBe(
      "Unpin this app",
    );
  });
});
