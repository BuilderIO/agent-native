// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useOrg: vi.fn(),
  isLocalDevelopmentOrigin: vi.fn(),
  shouldOfferWorkspace: vi.fn(),
  isWorkspaceAppEnvironment: vi.fn(),
}));

vi.mock("../../org/workspace-url.js", () => ({
  isLocalDevelopmentOrigin: mocks.isLocalDevelopmentOrigin,
  shouldOfferWorkspace: mocks.shouldOfferWorkspace,
}));
vi.mock("./hooks.js", () => ({
  useOrg: mocks.useOrg,
}));
vi.mock("./workspace-app-links.js", () => ({
  isWorkspaceAppEnvironment: mocks.isWorkspaceAppEnvironment,
}));

import { WorkspaceNotice } from "./WorkspaceNotice.js";

describe("WorkspaceNotice", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.useOrg.mockReset();
    mocks.useOrg.mockReturnValue({
      data: {
        orgName: "Acme",
        workspaceUrl: "https://workspace.example.com",
      },
    });
    mocks.isLocalDevelopmentOrigin.mockReturnValue(true);
    mocks.shouldOfferWorkspace.mockReturnValue(true);
    mocks.isWorkspaceAppEnvironment.mockReturnValue(false);
    window.history.replaceState({}, "", "http://localhost:3000/apps");
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("does not show the workspace CTA during local development", () => {
    act(() => {
      root.render(<WorkspaceNotice />);
    });

    expect(container.textContent).toBe("");
    expect(container.querySelector("a")).toBeNull();
  });

  it("does not show the workspace CTA inside a workspace app", () => {
    mocks.isLocalDevelopmentOrigin.mockReturnValue(false);
    mocks.isWorkspaceAppEnvironment.mockReturnValue(true);

    act(() => {
      root.render(<WorkspaceNotice />);
    });

    expect(container.textContent).toBe("");
    expect(container.querySelector("a")).toBeNull();
  });

  it("uses the warning treatment when shown on another hosted app", () => {
    mocks.isLocalDevelopmentOrigin.mockReturnValue(false);

    act(() => {
      root.render(<WorkspaceNotice />);
    });

    const banner = container.querySelector('[role="status"]');
    expect(banner).not.toBeNull();
    expect(banner?.className).toContain("bg-amber-500/10");
    expect(banner?.textContent).toContain("Go there");
  });
});
