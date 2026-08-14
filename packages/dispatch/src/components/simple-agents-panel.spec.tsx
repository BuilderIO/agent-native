import { describe, expect, it } from "vitest";

import {
  handleAgentPackMutationSuccess,
  isPendingWorkspaceResourceApproval,
} from "./simple-agents-panel";

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
