// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  describeSkippedPackFiles,
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

describe("describeSkippedPackFiles", () => {
  it("returns null when nothing was skipped", () => {
    expect(describeSkippedPackFiles([])).toBeNull();
  });

  it("frames a single skipped file as informational, not a failure", () => {
    const message = describeSkippedPackFiles([
      "Skipped non-text file: notes.pdf",
    ]);

    expect(message).toContain("the rest of the folder will still be imported");
    expect(message).toContain("Skipped non-text file: notes.pdf");
  });

  it("pluralizes the summary for multiple skipped files", () => {
    const message = describeSkippedPackFiles([
      "Skipped non-text file: a.pdf",
      "Skipped non-text file: b.png",
    ]);

    expect(message).toContain("2 files were skipped");
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

  it("shows the skipped-file notice as an informational status, not an error", async () => {
    await act(async () => {
      root.render(<SimpleAgentsPanel />);
    });

    const importButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Import or connect"),
    );
    await act(async () => {
      importButton?.click();
    });

    const folderTab = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Agent folder",
    );
    expect(folderTab).not.toBeUndefined();
    await act(async () => {
      folderTab?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });

    const folderInput = document.body.querySelector(
      'input[type="file"][multiple]',
    ) as HTMLInputElement | null;
    expect(folderInput).not.toBeNull();

    const files = [
      new File(["# notes"], "notes.md", { type: "text/markdown" }),
      new File(["binary"], "diagram.pdf", { type: "application/pdf" }),
    ];
    Object.defineProperty(folderInput, "files", {
      value: files,
      configurable: true,
    });

    await act(async () => {
      folderInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const notice = document.body.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Skipped non-text file");
    expect(notice?.textContent).toContain(
      "the rest of the folder will still be imported",
    );
    expect(notice?.className).not.toContain("destructive");
    expect(notice?.className).not.toMatch(/\bred-\d/);
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });
});
