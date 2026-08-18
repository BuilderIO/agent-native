// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BrowserChatRoute from "./browser-chat.js";

const browserChat = vi.hoisted(() => ({
  install: vi.fn(() => vi.fn()),
  embedActive: true,
  surfaceProps: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  AgentChatSurface: (props: Record<string, unknown>) => {
    browserChat.surfaceProps = props;
    return <div data-testid="browser-agent-chat" />;
  },
}));
vi.mock("@agent-native/core/client/host", () => ({
  isEmbedAuthActive: () => browserChat.embedActive,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { page?: string }) =>
    ({
      "dispatch.pages.browserChatUnavailableTitle":
        "Browser chat session unavailable",
      "dispatch.pages.browserChatUnavailableDescription":
        "Reconnect from the Agent-Native browser extension.",
      "dispatch.pages.browserChatPlaceholder": "Ask about this page…",
      "dispatch.pages.browserChatAttachedPlaceholder": `Ask about ${values?.page}…`,
    })[key] ?? key,
}));

vi.mock("../../lib/browser-chat-bridge.js", () => ({
  installBrowserChatBridge: browserChat.install,
}));

describe("BrowserChatRoute", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    browserChat.install.mockClear();
    browserChat.embedActive = true;
    browserChat.surfaceProps = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders the canonical narrow chat and installs the scoped bridge", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            "/browser-chat?browserChatNonce=browser-chat-nonce-1234567890&browserChatParentOrigin=chrome-extension%3A%2F%2Fabcdefghijklmnopabcdefghijklmnop",
          ]}
        >
          <BrowserChatRoute />
        </MemoryRouter>,
      );
    });

    expect(browserChat.install).toHaveBeenCalledWith(
      expect.objectContaining({
        nonce: "browser-chat-nonce-1234567890",
        parentOrigin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      }),
    );
    expect(browserChat.surfaceProps).toMatchObject({
      mode: "panel",
      storageKey: "dispatch",
      showHeader: false,
      showTabBar: false,
      allowSettingsMode: false,
      composerPlaceholder: "Ask about this page…",
    });
  });

  it("fails closed when the bridge query is incomplete", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/browser-chat"]}>
          <BrowserChatRoute />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Browser chat session unavailable");
    expect(browserChat.install).not.toHaveBeenCalled();
    expect(browserChat.surfaceProps).toBeNull();
  });

  it("does not install the bridge for a normally authenticated top-level route", async () => {
    browserChat.embedActive = false;

    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            "/browser-chat?browserChatNonce=browser-chat-nonce-1234567890&browserChatParentOrigin=chrome-extension%3A%2F%2Fabcdefghijklmnopabcdefghijklmnop",
          ]}
        >
          <BrowserChatRoute />
        </MemoryRouter>,
      );
    });

    expect(browserChat.install).not.toHaveBeenCalled();
    expect(browserChat.surfaceProps).toBeNull();
  });
});
