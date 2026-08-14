import { describe, expect, it } from "vitest";

import { shouldRouteDesktopAppToChatFirst } from "./desktop-shortcut-routing.js";

describe("desktop app shortcut routing", () => {
  it("keeps app shortcuts in the chat-first surface when it is available", () => {
    expect(
      shouldRouteDesktopAppToChatFirst({
        chatFirstMode: true,
        showCodeAgentsTab: true,
      }),
    ).toBe(true);
  });

  it("falls back to the legacy app surface only when chat-first is unavailable", () => {
    expect(
      shouldRouteDesktopAppToChatFirst({
        chatFirstMode: false,
        showCodeAgentsTab: true,
      }),
    ).toBe(false);
    expect(
      shouldRouteDesktopAppToChatFirst({
        chatFirstMode: true,
        showCodeAgentsTab: false,
      }),
    ).toBe(false);
  });
});
