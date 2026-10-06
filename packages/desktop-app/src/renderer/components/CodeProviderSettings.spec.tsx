// @vitest-environment happy-dom

import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { builderConnectFlow, connectBuilderProvider } = vi.hoisted(() => ({
  builderConnectFlow: {
    connecting: false,
    statusResolved: true,
    agentNativeProvisioningEnabled: true,
    start: vi.fn(),
  },
  connectBuilderProvider: vi.fn(async () => ({
    ok: true,
    settings: { providers: [] },
    message: "Builder.io connected for Code.",
  })),
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
  builderConnectFlow.start.mockClear();
  connectBuilderProvider.mockClear();
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

async function finishLazyLoad() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe("CodeProviderSettings Builder setup", () => {
  it("opens the shared chooser; only the existing-account choice starts local sign-in", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        codeAgents: { connectBuilderProvider },
      },
    });
    const openBuilder = vi.spyOn(window, "open");

    act(() => {
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
    });

    const getTrigger = () =>
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Use Builder.io"),
      );
    expect(getTrigger()).toBeDefined();
    click(getTrigger()!);
    await finishLazyLoad();
    expect(document.body.textContent).toContain("Create and activate");
    expect(document.body.textContent).toContain("I have a Builder.io account");
    expect(builderConnectFlow.start).not.toHaveBeenCalled();
    expect(connectBuilderProvider).not.toHaveBeenCalled();
    expect(openBuilder).not.toHaveBeenCalled();

    const createAndActivate = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Create and activate"));
    expect(createAndActivate).toBeDefined();
    click(createAndActivate!);
    expect(builderConnectFlow.start).toHaveBeenCalledWith({
      provisionAccount: true,
    });
    expect(connectBuilderProvider).not.toHaveBeenCalled();
    expect(openBuilder).not.toHaveBeenCalled();

    click(getTrigger()!);
    const signIn = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("I have a Builder.io account"),
    );
    expect(signIn).toBeDefined();
    click(signIn!);
    await act(async () => {
      await Promise.resolve();
    });
    expect(connectBuilderProvider).toHaveBeenCalledOnce();
    expect(builderConnectFlow.start).toHaveBeenCalledTimes(1);
    expect(openBuilder).not.toHaveBeenCalled();
  });
});
