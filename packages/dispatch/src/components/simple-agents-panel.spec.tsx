// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleAgentPackMutationSuccess,
  isPendingWorkspaceResourceApproval,
  SimpleAgentsPanel,
} from "./simple-agents-panel";

const queryState = vi.hoisted(() => ({
  data: [],
  isError: false,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  navigateWithAgentChatViewTransition: vi.fn(),
  sendToAgentChat: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useActionQuery: () => queryState,
}));

vi.mock("@agent-native/core/resources/metadata", () => ({
  parseCustomAgentProfile: vi.fn(),
}));

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

describe("agent pack resource mutations", () => {
  it("recognizes pending workspace-resource approvals", () => {
    expect(
      isPendingWorkspaceResourceApproval({
        status: "pending",
        changeType: "workspace-resource.update",
      }),
    ).toBe(true);
    expect(
      isPendingWorkspaceResourceApproval({
        status: "pending",
        changeType: "workspace-resource.create",
      }),
    ).toBe(true);
  });

  it("does not treat applied resources or unrelated pending results as approvals", () => {
    expect(
      isPendingWorkspaceResourceApproval({
        id: "resource_1",
        status: "applied",
        changeType: "workspace-resource.update",
      }),
    ).toBe(false);
    expect(
      isPendingWorkspaceResourceApproval({
        status: "pending",
        changeType: "destination.upsert",
      }),
    ).toBe(false);
    expect(isPendingWorkspaceResourceApproval(null)).toBe(false);
  });

  it("reports queued approval without running applied-only refresh work", () => {
    const notifications: string[] = [];
    const onApplied = () => notifications.push("refreshed");

    handleAgentPackMutationSuccess(
      { status: "pending", changeType: "workspace-resource.update" },
      {
        appliedMessage: "Pack file updated",
        approvalMessage: "Pack file update queued for approval",
        onApplied,
        notify: (message) => notifications.push(message),
      },
    );

    expect(notifications).toEqual(["Pack file update queued for approval"]);
  });

  it("reports applied and runs refresh work for an applied resource", () => {
    const notifications: string[] = [];

    handleAgentPackMutationSuccess(
      { id: "resource_1" },
      {
        appliedMessage: "Pack file added",
        approvalMessage: "Pack file addition queued for approval",
        onApplied: () => notifications.push("refreshed"),
        notify: (message) => notifications.push(message),
      },
    );

    expect(notifications).toEqual(["Pack file added", "refreshed"]);
  });
});

describe("SimpleAgentsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    queryState.data = [];
    queryState.isError = false;
    queryState.isLoading = false;
    queryState.error = null;
    queryState.refetch.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body
      .querySelectorAll("[data-radix-portal]")
      .forEach((portal) => portal.remove());
    vi.unstubAllGlobals();
  });

  it("keeps import and connect available when the workspace has no agents", async () => {
    await act(async () => {
      root.render(<SimpleAgentsPanel />);
    });

    const importButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Import or connect"),
    );
    expect(importButton).not.toBeUndefined();

    await act(async () => {
      importButton?.click();
    });

    expect(document.body.textContent).toContain("Import an agent");
    expect(document.body.textContent).toContain("Connect endpoint");
  });
});
