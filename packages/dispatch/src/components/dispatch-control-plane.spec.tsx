// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DispatchControlPlane } from "./dispatch-control-plane";
import { TooltipProvider } from "./ui/tooltip";

const clientState = vi.hoisted(() => ({
  navigateWithTransition: vi.fn(),
  promptComposerProps: null as Record<string, unknown> | null,
  useChatModels: vi.fn(() => ({
    availableModels: [],
    defaultModel: "auto",
    selectedModel: "auto",
    selectedEngine: "",
    selectedEffort: "medium" as const,
    isLoading: false,
    onModelChange: vi.fn(),
    onEffortChange: vi.fn(),
    refreshEngines: vi.fn(),
  })),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  navigateWithAgentChatViewTransition: (
    navigate: unknown,
    path: string,
    options?: unknown,
  ) => clientState.navigateWithTransition(navigate, path, options),
  useChatModels: clientState.useChatModels,
}));

vi.mock("@agent-native/core/client/composer", () => ({
  PromptComposer: (props: Record<string, unknown>) => {
    clientState.promptComposerProps = props;
    const onSubmit = props.onSubmit as (value: string) => void;
    const placeholder = props.placeholder as string;
    return (
      <button
        type="button"
        data-placeholder={placeholder}
        onClick={() => onSubmit("Route onboarding work")}
      >
        Composer
      </button>
    );
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/host", () => ({
  isInBuilderFrame: () => false,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { defaultValue?: string }) =>
    values?.defaultValue ?? key,
}));

vi.mock("./create-app-popover", () => ({
  CreateAppPopover: () => <div>Create app</div>,
}));

describe("DispatchControlPlane", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clientState.navigateWithTransition.mockReset();
    clientState.promptComposerProps = null;
    clientState.useChatModels.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders a minimal Ask surface and transitions submitted prompts into Chat", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <TooltipProvider>
            <DispatchControlPlane />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Chat across your apps");
    expect(container.textContent).not.toContain("Open chat");
    expect(container.textContent).not.toContain("Also");
    expect(container.textContent).not.toContain("active");
    expect(container.querySelector("nav")).toBeNull();
    expect(
      container.querySelector('[data-placeholder="Ask Dispatch anything..."]'),
    ).not.toBeNull();
    expect(clientState.useChatModels).toHaveBeenCalledWith({
      storageKey: "dispatch",
    });
    expect(clientState.promptComposerProps).toMatchObject({
      availableModels: [],
      modelListLoading: false,
      selectedEffort: "medium",
      selectedEngine: "",
      selectedModel: "auto",
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-placeholder]")?.click();
    });

    expect(clientState.navigateWithTransition).toHaveBeenCalledWith(
      expect.any(Function),
      "/chat",
      expect.objectContaining({
        state: {
          dispatchPrompt: expect.objectContaining({
            message: "Route onboarding work",
            selectedModel: "auto",
            selectedEngine: "",
            selectedEffort: "medium",
          }),
        },
      }),
    );
  });
});
