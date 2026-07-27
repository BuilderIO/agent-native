// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useBuilderConnectCardController,
  type BuilderConnectCardControllerOptions,
  type BuilderConnectCardViewModel,
} from "./useBuilderConnectCardController.js";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  useBuilderConnectFlow: vi.fn(),
}));

vi.mock("../settings/useBuilderStatus.js", () => ({
  useBuilderConnectFlow: mocks.useBuilderConnectFlow,
}));

describe("useBuilderConnectCardController", () => {
  let container: HTMLDivElement;
  let root: Root;
  let viewModel: BuilderConnectCardViewModel | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.useBuilderConnectFlow.mockReturnValue({
      configured: false,
      hasFetchedStatus: true,
      orgName: null,
      connecting: false,
      error: null,
      start: mocks.start,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    viewModel = undefined;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function Harness({
    options,
  }: {
    options?: BuilderConnectCardControllerOptions;
  }) {
    viewModel = useBuilderConnectCardController(options);
    return null;
  }

  function render(options?: BuilderConnectCardControllerOptions) {
    act(() => root.render(<Harness options={options} />));
    expect(viewModel).toBeDefined();
    return viewModel as BuilderConnectCardViewModel;
  }

  it("derives the default ready view model and starts the shared flow", () => {
    const result = render();

    expect(result).toMatchObject({
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
      },
    });
    expect(mocks.useBuilderConnectFlow).toHaveBeenCalledWith(
      expect.objectContaining({ trackingSource: "setup_connections_page" }),
    );

    act(() => result.action?.onPress());
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it("exposes checking and pending state without styling assumptions", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      configured: false,
      hasFetchedStatus: false,
      orgName: null,
      connecting: true,
      error: "Connection is taking longer than expected",
      start: mocks.start,
    });

    expect(render()).toMatchObject({
      status: { kind: "checking", label: "Checking" },
      configured: false,
      pending: true,
      error: "Connection is taking longer than expected",
      action: { pending: true, disabled: true },
    });
  });

  it("derives the organization label and hides the action when connected", () => {
    mocks.useBuilderConnectFlow.mockReturnValue({
      configured: true,
      hasFetchedStatus: true,
      orgName: "Acme workspace",
      connecting: false,
      error: null,
      start: mocks.start,
    });

    expect(render()).toMatchObject({
      status: { kind: "connected", label: "Connected to Acme workspace" },
      configured: true,
      pending: false,
      orgName: "Acme workspace",
      action: null,
    });
  });

  it("forwards custom copy, tracking, and the normalized connected callback", () => {
    const onConnected = vi.fn();
    const result = render({
      title: "Builder account",
      description: "Connect your company workspace.",
      trackingSource: "custom_surface",
      onConnected,
    });
    const flowOptions = mocks.useBuilderConnectFlow.mock.calls.at(-1)?.[0];

    expect(result.title).toBe("Builder account");
    expect(result.description).toBe("Connect your company workspace.");
    expect(flowOptions.trackingSource).toBe("custom_surface");

    act(() => flowOptions.onConnected({ orgName: "Acme workspace" }));
    expect(onConnected).toHaveBeenCalledOnce();
    expect(onConnected).toHaveBeenCalledWith("Acme workspace");
  });
});
