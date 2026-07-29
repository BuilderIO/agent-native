import { describe, expect, it, vi } from "vitest";

import { installWebviewNavigationListeners } from "./webview-navigation";

describe("webview navigation listeners", () => {
  it("forwards main-frame navigation from will-frame-navigate", () => {
    const listeners = new Map<string, (...args: never[]) => void>();
    const contents = {
      on: vi.fn((event: string, listener: (...args: never[]) => void) => {
        listeners.set(event, listener);
      }),
    } as unknown as Electron.WebContents;
    const handleNavigation = vi.fn();
    installWebviewNavigationListeners(contents, handleNavigation);

    const event = {
      isMainFrame: true,
      preventDefault: vi.fn(),
      url: "https://mail.agent-native.com/_agent-native/sign-in",
    };
    listeners.get("will-frame-navigate")?.(event as never);

    expect(handleNavigation).toHaveBeenCalledWith(event, event.url, {
      isMainFrame: true,
    });
  });

  it("forwards the legacy will-navigate URL when the event has no URL", () => {
    const listeners = new Map<string, (...args: never[]) => void>();
    const contents = {
      on: vi.fn((event: string, listener: (...args: never[]) => void) => {
        listeners.set(event, listener);
      }),
    } as unknown as Electron.WebContents;
    const handleNavigation = vi.fn();
    installWebviewNavigationListeners(contents, handleNavigation);

    const event = { preventDefault: vi.fn() };
    const url =
      "https://mail.agent-native.com/_agent-native/sign-in?return=%2Finbox";
    listeners.get("will-navigate")?.(event as never, url as never);

    expect(handleNavigation).toHaveBeenCalledWith(event, url, {
      isMainFrame: true,
    });
  });
});
