// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ImpactPreview,
  workspaceResourceMutationMessage,
} from "./workspace-resource-impact-preview";

const queryState = vi.hoisted(() => ({
  result: { data: null as any, isLoading: false },
  calls: [] as any[],
}));

vi.mock("@agent-native/core/client", () => ({
  useActionQuery: (...args: any[]) => {
    queryState.calls.push(args);
    return queryState.result;
  },
}));

describe("ImpactPreview", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    queryState.calls = [];
    queryState.result = { data: null, isLoading: false };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders All-app approval impact and override details", () => {
    queryState.result = {
      isLoading: false,
      data: {
        affectsAllApps: true,
        affectedApps: { count: 4 },
        approval: { willRequestApproval: true },
        overrides: {
          count: 2,
          items: [
            {
              scope: "shared",
              owner: "__shared__",
              label: "Organization/app override",
              updatedAt: 1,
            },
            {
              scope: "personal",
              owner: "person@example.test",
              label: "Personal override (person@example.test)",
              updatedAt: 2,
            },
          ],
        },
      },
    };

    act(() => {
      root.render(
        <ImpactPreview
          operation="update"
          resourceId="resource_1"
          scope="all"
        />,
      );
    });

    expect(queryState.calls[0]).toEqual([
      "preview-workspace-resource-change",
      {
        operation: "update",
        resourceId: "resource_1",
        path: undefined,
        scope: "all",
      },
      { enabled: true },
    ]);
    expect(container.textContent).toContain("All apps impact");
    expect(container.textContent).toContain("Approval required");
    expect(container.textContent).toContain("2 overrides");
    expect(container.textContent).toContain(
      "This change applies to every workspace app (4 discovered).",
    );
    expect(container.textContent).toContain(
      "It will be queued for approval before it takes effect.",
    );
    expect(container.textContent).toContain("Organization/app override");
    expect(container.textContent).toContain(
      "Personal override (person@example.test)",
    );
  });

  it("renders selected-only changes as immediate", () => {
    queryState.result = {
      isLoading: false,
      data: {
        affectsAllApps: false,
        affectedApps: { count: null },
        approval: { willRequestApproval: false },
        overrides: { count: 0, items: [] },
      },
    };

    act(() => {
      root.render(
        <ImpactPreview
          operation="create"
          path="context/private-launch.md"
          scope="selected"
        />,
      );
    });

    expect(container.textContent).toContain("Selected only");
    expect(container.textContent).toContain(
      "This change only applies to explicitly granted apps.",
    );
    expect(container.textContent).toContain(
      "It will take effect immediately when saved.",
    );
  });

  it("uses approval-request mutation copy only for workspace resource approvals", () => {
    expect(
      workspaceResourceMutationMessage(
        { status: "pending", changeType: "workspace-resource.update" },
        "Resource updated",
      ),
    ).toBe("Approval requested");
    expect(
      workspaceResourceMutationMessage(
        { status: "pending", changeType: "dream-proposal.apply" },
        "Resource updated",
      ),
    ).toBe("Resource updated");
  });
});
