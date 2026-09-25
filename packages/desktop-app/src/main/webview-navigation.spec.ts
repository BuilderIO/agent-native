import { describe, expect, it, vi } from "vitest";

import { installWebviewNavigationListeners } from "./webview-navigation";

describe("webview navigation listeners", () => {
  it("forwards only subframe navigation from will-frame-navigate", () => {
    const listeners = new Map<string, (...args: never[]) => void>();
    const contents = {
      on: vi.fn((event: string, listener: (...args: never[]) => void) => {
        listeners.set(event, listener);
      }),
    } as unknown as Electron.WebContents;
    const handleNavigation = vi.fn();
    installWebviewNavigationListeners(contents, handleNavigation);

    const mainFrameEvent = {
      isMainFrame: true,
      preventDefault: vi.fn(),
      url: "https://mail.agent-native.com/_agent-native/sign-in",
    };
    listeners.get("will-frame-navigate")?.(mainFrameEvent as never);
    expect(handleNavigation).not.toHaveBeenCalled();

    const subframeEvent = {
      isMainFrame: false,
      preventDefault: vi.fn(),
      url: "https://accounts.google.com/o/oauth2/auth",
    };
    listeners.get("will-frame-navigate")?.(subframeEvent as never);

    expect(handleNavigation).toHaveBeenCalledWith(
      subframeEvent,
      subframeEvent.url,
      {
        isMainFrame: false,
      },
    );
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
