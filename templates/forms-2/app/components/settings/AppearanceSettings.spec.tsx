// @vitest-environment happy-dom

// sprint-forms-2#193: the app showed the original's colours and nothing else, so the
// Agent-Native theme family was unreachable. The Appearance row must reach the shared
// theme-family control, and the settings page must actually render it.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// the real catalogs key these under the agentChat namespace
const copies: Record<string, string> = {
  "agentChat.settingsShell.account.appearance": "Appearance",
  "agentChat.settingsShell.account.themeFamily": "Theme family",
  "agentChat.settingsShell.account.themeFamilyAgentNative": "Agent-Native",
  "agentChat.settingsShell.account.themeFamilyOriginal": "Original app colors",
};
const setFamily = vi.fn(async () => {});

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => copies[key] ?? key,
}));
vi.mock("@agent-native/core/client/ui", () => ({
  useThemeFamily: () => ({
    family: "original",
    status: "ready",
    isForcedByUrl: false,
    setFamily,
  }),
}));

import { AppearanceSettings } from "./AppearanceSettings";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("forms-2 Appearance settings", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    setFamily.mockClear();
  });

  it("offers the app's theme family where the account settings live", async () => {
    await act(async () => {
      root.render(<AppearanceSettings />);
    });
    expect(host.textContent).toContain("Appearance");
    const trigger = host.querySelector('[aria-label="Theme family"]');
    expect(
      trigger,
      "the Appearance row needs the shared theme-family control",
    ).toBeTruthy();
  });

  it("switches to the Agent-Native family through that control", async () => {
    await act(async () => {
      root.render(<AppearanceSettings />);
    });
    const trigger = host.querySelector(
      '[aria-label="Theme family"]',
    ) as HTMLElement | null;
    expect(trigger).toBeTruthy();
    await act(async () => {
      trigger!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      trigger!.click();
    });
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (node) => node.textContent?.trim() === "Agent-Native",
    ) as HTMLElement | undefined;
    expect(option, "the Agent-Native option must be offered").toBeTruthy();
    await act(async () => {
      option!.click();
    });
    expect(setFamily).toHaveBeenCalledWith("agent-native");
  });
});
