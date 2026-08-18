import { describe, expect, it } from "vitest";

import { resolveDesktopChatRelayBase } from "./desktop-chat-relay.js";

describe("desktop chat relay URL", () => {
  it("derives a framework request base from the app chat endpoint", () => {
    expect(
      resolveDesktopChatRelayBase(
        "http://127.0.0.1:43123/desktop-chat/secret/mail/_agent-native/agent-chat",
      ),
    ).toBe("http://127.0.0.1:43123/desktop-chat/secret/mail");
  });

  it("fails closed for non-relay URLs", () => {
    expect(resolveDesktopChatRelayBase(null)).toBeNull();
    expect(resolveDesktopChatRelayBase("/_agent-native/agent-chat")).toBeNull();
  });
});
