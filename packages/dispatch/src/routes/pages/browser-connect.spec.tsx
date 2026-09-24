// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BrowserConnectRoute from "./browser-connect.js";

const browserConnect = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({
    mutateAsync: browserConnect.mutateAsync,
    isPending: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "dispatch.pages.browserConnectTitle": "Connect browser chat",
      "dispatch.pages.browserConnectDescription": "Description",
      "dispatch.pages.browserConnectInvalid": "Invalid request",
      "dispatch.pages.browserConnectConnected": "Connected",
      "dispatch.pages.browserConnectConnecting": "Connecting",
      "dispatch.pages.browserConnectButton": "Connect",
      "dispatch.pages.browserConnectOpenFromExtension": "Open from extension",
      "dispatch.pages.browserConnectFailed": "Connection failed",
    })[key] ?? key,
}));

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const nonce = "browser-chat-nonce-1234567890";

describe("BrowserConnectRoute", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    browserConnect.mutateAsync.mockReset();
    browserConnect.sendMessage.mockReset();
    browserConnect.sendMessage.mockImplementation(
      (
        _extensionId: string,
        _message: Record<string, unknown>,
        callback: (response: { ok: boolean }) => void,
      ) => callback({ ok: true }),
    );
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: browserConnect.sendMessage,
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("requires an explicit click before sending a one-time session to the exact extension", async () => {
    browserConnect.mutateAsync.mockResolvedValue({
      startPath: "/_agent-native/embed/start?ticket=one-time-ticket",
      expiresAt: 1_900_000_000_000,
      parentOrigin: `chrome-extension://${extensionId}`,
      remoteDevice: {
        id: "remote-device-example",
        token: "anr_example",
      },
      relayBaseUrl: "https://dispatch.example.com",
    });

    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            `/browser-connect?extensionId=${extensionId}&nonce=${nonce}`,
          ]}
        >
          <BrowserConnectRoute />
        </MemoryRouter>,
      );
    });
    expect(browserConnect.mutateAsync).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector("button")?.click();
    });

    expect(browserConnect.mutateAsync).toHaveBeenCalledWith({
      extensionId,
      nonce,
    });
    expect(browserConnect.sendMessage).toHaveBeenCalledWith(
      extensionId,
      {
        type: "browser-chat.session.v1",
        nonce,
        startPath: "/_agent-native/embed/start?ticket=one-time-ticket",
        dispatchOrigin: window.location.origin,
        expiresAt: "2030-03-17T17:46:40.000Z",
        remoteDevice: {
          id: "remote-device-example",
          token: "anr_example",
        },
        relayBaseUrl: "https://dispatch.example.com",
      },
      expect.any(Function),
    );
    expect(container.textContent).toContain("Connected");
  });

  it("fails closed on malformed connection parameters", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            "/browser-connect?extensionId=wildcard&nonce=too-short",
          ]}
        >
          <BrowserConnectRoute />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Invalid request");
    expect(container.querySelector("button")).toBeNull();
  });
});
