// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setDelegation: { error: null, isPending: false, mutate: vi.fn() },
}));

vi.mock("@agent-native/core/client/org", () => ({
  useSetA2AMemberDelegation: () => mocks.setDelegation,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";

import { A2AMemberDelegationSection } from "./AuthenticationSection.js";

describe("A2AMemberDelegationSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows the owner-controlled setting and sends the selected value", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <A2AMemberDelegationSection enabled={false} />
        </TooltipProvider>,
      );
    });

    const toggle = container.querySelector('[role="switch"]');
    expect(toggle?.getAttribute("aria-label")).toBe(
      "agentChat.settingsOrg.auth.memberDelegation",
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("false");

    act(() =>
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    expect(mocks.setDelegation.mutate).toHaveBeenCalledWith(true);
  });
});
