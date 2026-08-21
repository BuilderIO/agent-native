// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installDesktopChatFetchRelay,
  resolveDesktopChatRelayBase,
  setDesktopChatRelayActive,
  setDesktopChatRelayBase,
} from "./desktop-chat-relay.js";

const requested: string[] = [];
const underlyingFetch = vi.fn(async (input: RequestInfo | URL) => {
  requested.push(input instanceof Request ? input.url : String(input));
  return new Response("{}", { status: 200 });
});

window.fetch = underlyingFetch as unknown as typeof window.fetch;
installDesktopChatFetchRelay();

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

  afterEach(() => {
    requested.length = 0;
    setDesktopChatRelayBase("mail", null);
    setDesktopChatRelayBase("calendar", null);
    setDesktopChatRelayActive("mail", false);
    setDesktopChatRelayActive("calendar", false);
    underlyingFetch.mockClear();
  });

  it("routes unattributed framework fetches through the active shell", async () => {
    setDesktopChatRelayBase(
      "mail",
      "http://127.0.0.1:43101/desktop-chat/mail-secret/mail/_agent-native/agent-chat",
    );
    setDesktopChatRelayBase(
      "calendar",
      "http://127.0.0.1:43102/desktop-chat/calendar-secret/calendar/_agent-native/agent-chat",
    );
    setDesktopChatRelayActive("calendar", true);

    await window.fetch("/_agent-native/poll");

    expect(requested).toEqual([
      "http://127.0.0.1:43102/desktop-chat/calendar-secret/calendar/_agent-native/poll",
    ]);
  });

  it("keeps throwing when mounted shells do not name one active owner", () => {
    setDesktopChatRelayBase(
      "mail",
      "http://127.0.0.1:43101/desktop-chat/mail-secret/mail/_agent-native/agent-chat",
    );
    setDesktopChatRelayBase(
      "calendar",
      "http://127.0.0.1:43102/desktop-chat/calendar-secret/calendar/_agent-native/agent-chat",
    );

    expect(() => window.fetch("/_agent-native/poll")).toThrow(
      /Unattributed .*mail, calendar/,
    );
  });
});
