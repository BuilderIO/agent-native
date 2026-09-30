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
        "Connect Builder.io for managed model access, browser automation, and workspace identity. Free tier available.",
      status: { kind: "ready", label: "Ready to connect" },
      configured: false,
      pending: false,
      error: null,
      orgName: null,
      action: {
        label: "Connect Builder.io",
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

  describe("with a named connection", () => {
    const memberRidingOrg = {
      configured: true,
      hasFetchedStatus: true,
      orgName: "Acme workspace",
      connecting: false,
      error: null,
      grants: { org: { connectedAt: 1_000, needsReconnect: false } },
      effective: "org",
      canConnect: { org: false, personal: true },
      start: mocks.start,
    };

    it("offers a member Connect on the Personal row while the org connection is in use", () => {
      mocks.useBuilderConnectFlow.mockReturnValue(memberRidingOrg);

      const result = render({ scope: "personal" });
      expect(result).toMatchObject({
        configured: false,
        status: { kind: "ready" },
        scope: "personal",
        action: { label: "Connect Builder.io" },
      });

      act(() => result.action?.onPress(true));
      expect(mocks.start).toHaveBeenCalledWith({
        provisionAccount: true,
        scope: "personal",
      });
    });

    it("keeps the Organization row connected and without an action for a member", () => {
      mocks.useBuilderConnectFlow.mockReturnValue(memberRidingOrg);

      expect(render({ scope: "org" })).toMatchObject({
        configured: true,
        status: { kind: "connected" },
        action: null,
      });
    });

    it("offers no Connect a caller isn't allowed to make", () => {
      mocks.useBuilderConnectFlow.mockReturnValue({
        ...memberRidingOrg,
        grants: {},
        effective: null,
        configured: false,
      });

      expect(render({ scope: "org" })).toMatchObject({
        configured: false,
        action: null,
      });
    });

    it("shows an organization connected by stored keys as connected", () => {
      mocks.useBuilderConnectFlow.mockReturnValue({
        ...memberRidingOrg,
        grants: {
          org: { connectedAt: 1_000, needsReconnect: false, kind: "keys" },
        },
        canConnect: { org: true, personal: false },
      });

      expect(render({ scope: "org" })).toMatchObject({
        configured: true,
        status: { kind: "connected" },
        action: null,
      });
    });

    it("treats a grant that needs reconnecting as not connected", () => {
      mocks.useBuilderConnectFlow.mockReturnValue({
        ...memberRidingOrg,
        grants: {
          org: { connectedAt: 1_000, needsReconnect: false },
          personal: {
            connectedAt: 2_000,
            needsReconnect: true,
            restricted: false,
          },
        },
      });

      expect(render({ scope: "personal" })).toMatchObject({
        configured: false,
        action: { label: "Connect Builder.io" },
      });
    });
  });
});
