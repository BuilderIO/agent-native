// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://analytics.agent-native.com/ask"}

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useOrg: vi.fn(),
  useAcceptInvitation: vi.fn(),
  useJoinByDomain: vi.fn(),
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: mocks.useOrg,
  useAcceptInvitation: mocks.useAcceptInvitation,
  useJoinByDomain: mocks.useJoinByDomain,
}));

import { InvitationBanner } from "./InvitationBanner.js";

describe("InvitationBanner", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.useOrg.mockReturnValue({
      data: {
        orgName: "Builder.io",
        workspaceUrl: "https://agent-workspace.builder.io",
        pendingInvitations: [],
        domainMatches: [],
      },
    });
    mocks.useAcceptInvitation.mockReturnValue({
      error: null,
      isPending: false,
      mutate: vi.fn(),
    });
    mocks.useJoinByDomain.mockReturnValue({
      error: null,
      isPending: false,
      mutate: vi.fn(),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("does not show a workspace banner on a hosted app when workspaceUrl is set", () => {
    act(() => {
      root.render(<InvitationBanner />);
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).not.toContain("Go there");
    expect(container.textContent).not.toContain("Stay here");
  });
});
