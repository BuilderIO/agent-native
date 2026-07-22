// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BuilderConnectCard } from "./BuilderConnectCard.js";
import type { BuilderConnectCardViewModel } from "./useBuilderConnectCardController.js";

const mocks = vi.hoisted(() => ({
  actionButton: undefined as unknown,
  useBuilderConnectCardController: vi.fn(),
  semanticActionProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("./useBuilderConnectCardController.js", () => ({
  useBuilderConnectCardController: mocks.useBuilderConnectCardController,
}));

vi.mock("@agent-native/toolkit/design-system", () => ({
  useDesignSystem: () =>
    mocks.actionButton
      ? { components: { ActionButton: mocks.actionButton } }
      : undefined,
  ActionButton: ({ children, onPress, ...props }: any) => {
    mocks.semanticActionProps = props;
    return (
      <button data-semantic-action="true" onClick={() => onPress()}>
        {children}
      </button>
    );
  },
}));

describe("BuilderConnectCard", () => {
  let container: HTMLDivElement;
  let root: Root;
  let viewModel: BuilderConnectCardViewModel;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    viewModel = {
      title: "Builder connect",
      description:
        "Connect Builder for managed model access, browser automation, and workspace identity.",
      status: { kind: "ready", label: "Ready to connect" },
      configured: false,
      pending: false,
      error: null,
      orgName: null,
      action: {
        label: "Connect Builder",
        pending: false,
        disabled: false,
        onPress: vi.fn(),
      },
    };
    mocks.useBuilderConnectCardController.mockReturnValue(viewModel);
    mocks.actionButton = undefined;
    mocks.semanticActionProps = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the default view and action on the shared controller", () => {
    act(() => root.render(<BuilderConnectCard trackingSource="settings" />));

    expect(mocks.useBuilderConnectCardController).toHaveBeenCalledOnce();
    expect(mocks.useBuilderConnectCardController).toHaveBeenCalledWith(
      expect.objectContaining({ trackingSource: "settings" }),
    );
    expect(container.textContent).toContain("Builder connect");
    expect(container.textContent).toContain("Ready to connect");
    expect(container.querySelector("[data-semantic-action]")).toBeNull();

    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    expect(viewModel.action?.onPress).toHaveBeenCalledOnce();
  });

  it("passes the same view model to a product-concept renderer", () => {
    const render = vi.fn((model: BuilderConnectCardViewModel) => (
      <article data-custom-card="true">{model.status.label}</article>
    ));

    act(() => root.render(<BuilderConnectCard render={render} />));

    expect(mocks.useBuilderConnectCardController).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(viewModel);
    expect(container.querySelector("[data-custom-card]")?.textContent).toBe(
      "Ready to connect",
    );
  });

  it("uses the semantic action contract when a design system supplies it", () => {
    mocks.actionButton = function CompanyActionButton() {
      return null;
    };
    viewModel.pending = true;
    viewModel.action = {
      ...viewModel.action!,
      pending: true,
      disabled: true,
    };

    act(() => root.render(<BuilderConnectCard />));

    expect(container.querySelector("[data-semantic-action]")).not.toBeNull();
    expect(mocks.semanticActionProps).toMatchObject({
      type: "button",
      intent: "primary",
      size: "compact",
      pending: true,
      disabled: true,
    });
    expect(mocks.useBuilderConnectCardController).toHaveBeenCalledOnce();
  });
});
