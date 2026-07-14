// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DispatchControlPlane } from "./dispatch-control-plane";
import { TooltipProvider } from "./ui/tooltip";

const clientState = vi.hoisted(() => ({
  navigateWithTransition: vi.fn(),
}));

vi.mock("@agent-native/core/client", () => ({
  PromptComposer: ({
    onSubmit,
    placeholder,
  }: {
    onSubmit: (value: string) => void;
    placeholder: string;
  }) => (
    <button
      type="button"
      data-placeholder={placeholder}
      onClick={() => onSubmit("Route onboarding work")}
    >
      Composer
    </button>
  ),
  isInBuilderFrame: () => false,
  navigateWithAgentChatViewTransition: (
    navigate: unknown,
    path: string,
    options?: unknown,
  ) => clientState.navigateWithTransition(navigate, path, options),
  useActionQuery: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useChatModels: () => ({ selectedModel: "auto" }),
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
          }),
        },
      }),
    );
  });
});
