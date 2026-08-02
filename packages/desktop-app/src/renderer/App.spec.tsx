// @vitest-environment happy-dom

import { DESKTOP_DEFAULT_APPS } from "@shared/app-registry";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

vi.mock("./components/AppSettings.js", () => ({
  default: () => <div role="dialog">App Settings</div>,
  AddAppDialog: () => null,
  AppEditForm: () => null,
}));

vi.mock("./components/AppWebview.js", async () => {
  const react = await import("react");
  return {
    default: react.forwardRef(() => (
      <div data-testid="slow-webview">Still loading</div>
    )),
  };
});

vi.mock("./components/CodeAgentsHub.js", () => ({ default: () => null }));
vi.mock("./components/TabBar.js", () => ({ default: () => null }));
vi.mock("./components/UpdatePrompt.js", () => ({ default: () => null }));
vi.mock("./components/UpdateIndicator.js", () => ({
  UpdateIndicator: () => null,
}));

import App from "./App.js";

describe("Desktop shell Settings boundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.electronAPI = {
      appConfig: {
        load: vi.fn(async () => [
          { ...DESKTOP_DEFAULT_APPS.find((app) => app.id === "mail")! },
        ]),
      },
      frame: {
        load: vi.fn(async () => ({
          enabled: false,
          showCodeTab: false,
          mode: "prod" as const,
        })),
      },
      setActiveApp: vi.fn(),
    } as unknown as ElectronAPI;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens Settings while the active app is still loading", async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="slow-webview"]'),
    ).not.toBeNull();
    const settings = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Settings"]',
    );
    expect(settings).not.toBeNull();

    act(() => settings?.click());

    expect(container.querySelector('[role="dialog"]')?.textContent).toBe(
      "App Settings",
    );
  });
});
