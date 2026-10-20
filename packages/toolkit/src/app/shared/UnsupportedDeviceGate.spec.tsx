// @vitest-environment happy-dom

const session = vi.hoisted(() => ({
  current: { email: "pat@example.com" } as { email?: string } | null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: session.current }),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UnsupportedDeviceGate } from "./UnsupportedDeviceGate.js";

function mockScreen(width: number, height: number) {
  Object.defineProperty(window.screen, "width", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(window.screen, "height", {
    value: height,
    configurable: true,
  });
}

function mockMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

describe("UnsupportedDeviceGate", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    session.current = { email: "pat@example.com" };
    mockScreen(390, 844);
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render() {
    act(() =>
      root.render(
        <UnsupportedDeviceGate appName="Slides">
          <div data-testid="app" />
        </UnsupportedDeviceGate>,
      ),
    );
  }

  const buttonLabels = () =>
    [...container.querySelectorAll("button")].map((b) => b.textContent);

  it("renders the app on screens that are not small touch screens", () => {
    mockMatchMedia(false);
    render();
    expect(container.querySelector('[data-testid="app"]')).not.toBeNull();
    expect(container.querySelector("main")).toBeNull();
  });

  it("keeps the app in a narrow iPad window", () => {
    mockMatchMedia(true);
    mockScreen(820, 1180);
    render();
    expect(container.querySelector('[data-testid="app"]')).not.toBeNull();
  });

  it("gates a phone turned sideways", () => {
    mockMatchMedia(true);
    mockScreen(844, 390);
    render();
    expect(container.querySelector("main")).not.toBeNull();
  });

  it("offers email first, then copy, to a signed-in visitor without share", () => {
    mockMatchMedia(true);
    render();
    expect(buttonLabels()).toEqual([
      "agentChat.unsupportedDevice.email",
      "agentChat.unsupportedDevice.copy",
    ]);
  });

  it("offers no email action when the visitor's address is unknown", () => {
    mockMatchMedia(true);
    session.current = null;
    render();
    expect(buttonLabels()).toEqual(["agentChat.unsupportedDevice.copy"]);
  });

  it("leads with share, then email, when the browser can share", () => {
    mockMatchMedia(true);
    Object.defineProperty(navigator, "share", {
      value: vi.fn(),
      configurable: true,
    });
    render();
    expect(buttonLabels()).toEqual([
      "agentChat.unsupportedDevice.share",
      "agentChat.unsupportedDevice.email",
    ]);
  });
});
