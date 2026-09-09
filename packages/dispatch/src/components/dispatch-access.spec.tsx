// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useOrgRole: vi.fn(),
}));

vi.mock("@agent-native/core/client/org", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/org")>();
  return {
    ...actual,
    useOrgRole: mocks.useOrgRole,
  };
});

import { RequireDispatchAccess } from "./dispatch-access.js";

describe("RequireDispatchAccess", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    mocks.useOrgRole.mockReset();
    vi.unstubAllGlobals();
  });

  it.each(["owner", "admin"] as const)(
    "renders the Dispatch shell for an organization %s",
    (role) => {
      mocks.useOrgRole.mockReturnValue({
        org: { orgId: "org-1" },
        role,
        isLoading: false,
        error: null,
      });

      act(() => {
        root.render(
          <RequireDispatchAccess>
            <div data-dispatch-shell>Dispatch shell</div>
          </RequireDispatchAccess>,
        );
      });

      expect(container.querySelector("[data-dispatch-shell]")).not.toBeNull();
    },
  );

  it("does not render the Dispatch shell for an organization member", () => {
    mocks.useOrgRole.mockReturnValue({
      org: { orgId: "org-1" },
      role: "member",
      isLoading: false,
      error: null,
    });

    act(() => {
      root.render(
        <RequireDispatchAccess>
          <div data-dispatch-shell>Dispatch shell</div>
        </RequireDispatchAccess>,
      );
    });

    expect(container.querySelector("[data-dispatch-shell]")).toBeNull();
  });
});
