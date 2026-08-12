// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useOrg: vi.fn(),
}));

vi.mock("./hooks.js", () => ({
  useOrg: mocks.useOrg,
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
});
