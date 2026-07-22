// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BuilderConnectCard } from "./BuilderConnectCard.js";
import type { BuilderConnectCardViewModel } from "./useBuilderConnectCardController.js";

const mocks = vi.hoisted(() => ({
  useBuilderConnectCardController: vi.fn(),
  semanticActionProps: undefined as Record<string, unknown> | undefined,
  semanticStatusProps: undefined as Record<string, unknown> | undefined,
  semanticSurfaceProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("./useBuilderConnectCardController.js", () => ({
  useBuilderConnectCardController: mocks.useBuilderConnectCardController,
}));

vi.mock("@agent-native/toolkit/design-system", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/toolkit/design-system")
    >();
  return {
    ...actual,
    ActionButton: ({ children, onPress, ...props }: any) => {
      mocks.semanticActionProps = props;
      return (
        <button
          data-semantic-action="true"
          disabled={props.disabled}
          onClick={() => onPress?.()}
        >
          {children}
        </button>
      );
    },
    Status: ({ children, ...props }: any) => {
      mocks.semanticStatusProps = props;
      return <span data-semantic-status="true">{children}</span>;
    },
    Surface: ({ children, ...props }: any) => {
      mocks.semanticSurfaceProps = props;
      return <section data-semantic-surface="true">{children}</section>;
    },
  };
});

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
    mocks.semanticActionProps = undefined;
    mocks.semanticStatusProps = undefined;
    mocks.semanticSurfaceProps = undefined;
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
    expect(container.querySelector("[data-semantic-action]")).not.toBeNull();
    expect(container.querySelector("[data-semantic-status]")).not.toBeNull();
    expect(container.querySelector("[data-semantic-surface]")).not.toBeNull();
    expect(mocks.semanticSurfaceProps).toMatchObject({
      as: "section",
      elevation: "low",
      padding: "none",
    });
    expect(mocks.semanticStatusProps).toMatchObject({
      tone: "neutral",
      size: "compact",
    });

    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    expect(viewModel.action?.onPress).toHaveBeenCalledOnce();
  });

  it("passes the same view model to a product-concept renderer", () => {
    const render = vi.fn(
      ({ viewModel }: { viewModel: BuilderConnectCardViewModel }) => (
        <article data-custom-card="true">{viewModel.status.label}</article>
      ),
    );

    act(() =>
      root.render(<BuilderConnectCard className="host-card" render={render} />),
    );

    expect(mocks.useBuilderConnectCardController).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith({ viewModel, className: "host-card" });
    expect(container.querySelector("[data-custom-card]")?.textContent).toBe(
      "Ready to connect",
    );
  });

  it("uses the semantic action contract for pending state", () => {
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

  it("falls back to the default view when a product renderer fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    act(() =>
      root.render(
        <BuilderConnectCard
          render={() => {
            throw new Error("broken company card");
          }}
        />,
      ),
    );

    expect(container.textContent).toContain("Builder connect");
    expect(container.textContent).toContain("Ready to connect");
  });
});
