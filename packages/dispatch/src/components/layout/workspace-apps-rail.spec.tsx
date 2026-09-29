// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientState = vi.hoisted(() => ({
  actions: [] as string[],
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (action: string) => {
    clientState.actions.push(action);
    return {
      data:
        action === "list-workspace-apps"
          ? [
              {
                id: "reports",
                name: "Reports",
                path: "/reports",
                url: "/reports",
                status: "ready",
              },
            ]
          : [
              {
                id: "internal-app",
                name: "Internal app",
                url: "https://internal.example.test",
                homeUrl: "https://internal.example.test",
                source: "builtin",
              },
            ],
      isError: false,
    };
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (_key: string, values?: { defaultValue?: string }) =>
    values?.defaultValue ?? "Workspace apps",
}));

import { WorkspaceAppsRail } from "./workspace-apps-rail";

describe("WorkspaceAppsRail", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clientState.actions = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("lists mounted workspace apps without connected agents", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/overview"]}>
          <WorkspaceAppsRail />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Reports");
    expect(container.textContent).not.toContain("Internal app");
    expect(container.querySelector('a[href="/apps/reports"]')).not.toBeNull();
    expect(clientState.actions).toEqual(["list-workspace-apps"]);
  });
});
