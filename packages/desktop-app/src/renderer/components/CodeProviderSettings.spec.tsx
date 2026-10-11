// @vitest-environment happy-dom

import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { builderConnectFlow } = vi.hoisted(() => ({
  builderConnectFlow: {
    connecting: false,
    configured: false,
    accountExists: false,
    error: null as string | null,
    statusResolved: true,
    agentNativeProvisioningEnabled: true,
    start: vi.fn(),
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { defaultValue?: string }) => {
    if (options?.defaultValue) return options.defaultValue;
    if (key === "agentChat.onboarding.builderCreateAndActivate") {
      return "Create and activate";
    }
    if (key === "agentChat.onboarding.builderExistingAccount") {
      return "I have a Builder.io account";
    }
    return key;
  },
}));

vi.mock("@agent-native/core/client/onboarding/use-onboarding", () => ({
  useOnboarding: () => ({
    loading: false,
    error: null,
    profile: { capabilities: [] },
  }),
}));

vi.mock("@agent-native/toolkit/app/settings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/toolkit/app/settings")>();
  return {
    ...actual,
    useBuilderConnectFlow: () => builderConnectFlow,
  };
});

import { CodeProviderSettings } from "./CodeProviderSettings.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  builderConnectFlow.connecting = false;
  builderConnectFlow.configured = false;
  builderConnectFlow.accountExists = false;
  builderConnectFlow.error = null;
  builderConnectFlow.start.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: undefined,
  });
  vi.restoreAllMocks();
});

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

describe("CodeProviderSettings Builder setup", () => {
  it("opens the shared chooser; each choice starts its matching Builder flow", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        codeAgents: {
          getBuilderConnectionStatus: vi.fn(),
          activateBuilderAccount: vi.fn(),
          getProviderSettings: vi.fn(async () => ({ providers: [] })),
        },
      },
    });
    const openBuilder = vi.spyOn(window, "open");
    const renderSettings = () =>
      root.render(
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(CodeProviderSettings, {
            settings: { providers: [] } as never,
            onSettingsChanged: vi.fn(),
          }),
        ),
      );

    act(renderSettings);

    const getTrigger = () =>
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Use Builder.io"),
      );
    expect(getTrigger()).toBeDefined();
    click(getTrigger()!);
    await vi.waitFor(
      () => {
        expect(document.body.textContent).toContain("Create and activate");
        expect(document.body.textContent).toContain(
          "I have a Builder.io account",
        );
      },
      { timeout: 5_000 },
    );
    expect(builderConnectFlow.start).not.toHaveBeenCalled();
    expect(openBuilder).not.toHaveBeenCalled();

    const createAndActivate = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Create and activate"));
    expect(createAndActivate).toBeDefined();
    click(createAndActivate!);
    expect(builderConnectFlow.start).toHaveBeenCalledWith({
      provisionAccount: true,
    });
    expect(openBuilder).not.toHaveBeenCalled();

    act(() => {
      builderConnectFlow.connecting = true;
      renderSettings();
    });
    expect(document.body.querySelector('[role="status"]')).not.toBeNull();
    act(() => {
      builderConnectFlow.connecting = false;
      builderConnectFlow.configured = true;
      renderSettings();
    });

    click(getTrigger()!);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        "I have a Builder.io account",
      );
    });
    const signIn = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("I have a Builder.io account"),
    );
    expect(signIn).toBeDefined();
    click(signIn!);
    expect(builderConnectFlow.start).toHaveBeenCalledWith({
      provisionAccount: false,
    });
    expect(builderConnectFlow.start).toHaveBeenCalledTimes(2);
    expect(openBuilder).not.toHaveBeenCalled();
  });
});
