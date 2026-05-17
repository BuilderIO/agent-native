// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppResourceEffectiveStack,
  appAvailabilityLabel,
  appLayerState,
} from "./workspace-resource-effective-stack";

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

describe("AppResourceEffectiveStack", () => {
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

  it("renders the effective layer stack and winning override", () => {
    queryState.result = {
      isLoading: false,
      data: {
        availability: "all-apps",
        effectiveResource: {
          owner: "person@example.test",
          path: "context/brand.md",
        },
        layers: [
          {
            scope: "workspace",
            label: "Workspace default",
            owner: "__workspace__",
            resource: {
              path: "context/brand.md",
              updatedAt: 1,
            },
            exists: true,
            effective: false,
            overridden: true,
          },
          {
            scope: "shared",
            label: "Organization/app override",
            owner: "__shared__",
            resource: null,
            exists: false,
            effective: false,
            overridden: false,
          },
          {
            scope: "personal",
            label: "Personal override",
            owner: "person@example.test",
            resource: {
              path: "context/brand.md",
              updatedAt: 2,
            },
            exists: true,
            effective: true,
            overridden: false,
          },
        ],
      },
    };

    act(() => {
      root.render(
        <AppResourceEffectiveStack
          appId="analytics"
          resource={{ id: "resource_1", path: "context/brand.md" }}
        />,
      );
    });

    expect(queryState.calls[0]).toEqual([
      "get-workspace-resource-effective-context",
      { resourceId: "resource_1", appId: "analytics" },
      { enabled: true },
    ]);
    expect(container.textContent).toContain("Effective context stack");
    expect(container.textContent).toContain("Inherited by all apps");
    expect(container.textContent).toContain("Workspace default");
    expect(container.textContent).toContain("Organization/app override");
    expect(container.textContent).toContain("Personal override");
    expect(container.textContent).toContain("Overridden");
    expect(container.textContent).toContain("Wins");
    expect(container.textContent).toContain("No file at this layer");
    expect(container.textContent).toContain(
      "person@example.test/context/brand.md",
    );
  });

  it("keeps availability and layer-state labels stable", () => {
    expect(appAvailabilityLabel("selected-granted")).toBe(
      "Granted to this app",
    );
    expect(appAvailabilityLabel("selected-not-granted")).toBe("Not granted");
    expect(appLayerState({ effective: true }).label).toBe("Wins");
    expect(appLayerState({ overridden: true }).label).toBe("Overridden");
    expect(appLayerState({}).label).toBe("Missing");
  });
});
