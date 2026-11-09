// @vitest-environment happy-dom

import type {
  FeatureFlagMetadata,
  FeatureFlagRuleScopes,
} from "@agent-native/core/client/feature-flags/types";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string, options?: { count?: number }): string =>
      options?.count === undefined ? key : `${key}:${options.count}`,
}));

import { FeatureFlagsEditor } from "./FeatureFlagsPanel.js";

const ORG = "org-1";
const UNSET_ORG = { state: "unset", canManage: true, orgId: ORG } as const;
const UNSET_GLOBAL = { state: "unset", canManage: false } as const;

function flag(scopes: FeatureFlagRuleScopes): FeatureFlagMetadata {
  return { key: "new-editor", defaultValue: false, scopes };
}

describe("FeatureFlagsEditor", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onMutate = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onMutate.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(target: FeatureFlagMetadata) {
    act(() => {
      root.render(
        <TooltipProvider>
          <FeatureFlagsEditor flags={[target]} onMutate={onMutate} />
        </TooltipProvider>,
      );
    });
    const enable = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("featureFlags.enableForMe"),
    );
    if (!enable) throw new Error("Enable for me button not rendered");
    return { enable, text: container.textContent ?? "" };
  }

  it("won't start an org's own rule while the global rule decides for it", () => {
    const { enable, text } = render(
      flag({
        inEffect: "global",
        global: {
          state: "withheld",
          summary: {
            mode: "rules",
            emailCount: 2,
            orgIdCount: 1,
            percentage: 10,
          },
          canManage: false,
        },
        org: UNSET_ORG,
      }),
    );

    expect(enable.disabled).toBe(true);
    expect(text).toContain(
      "featureFlags.emailCount:2 · featureFlags.organizationCount:1 · featureFlags.percentageRollout:10",
    );
    expect(text).not.toContain("agentChat.featureFlags.scope.unreadable");
  });

  it("won't add to a rule that couldn't be read", () => {
    const { enable, text } = render(
      flag({
        inEffect: "org",
        global: UNSET_GLOBAL,
        org: {
          state: "unreadable",
          problem: "stored rules are not JSON",
          canManage: true,
          orgId: ORG,
        },
      }),
    );

    expect(enable.disabled).toBe(true);
    expect(text).toContain("agentChat.featureFlags.scope.unreadable");
  });

  it("adds the caller to the org rule that decides for them", () => {
    const rules = {
      version: 1,
      mode: "rules",
      emails: ["teammate@example.test"],
      orgIds: [],
      percentage: 0,
    } as const;
    const { enable } = render({
      ...flag({
        inEffect: "org",
        global: UNSET_GLOBAL,
        org: { state: "set", rules, canManage: true, orgId: ORG },
      }),
      rules,
    });

    expect(enable.disabled).toBe(false);
    act(() => enable.click());
    expect(onMutate).toHaveBeenCalledWith({
      key: "new-editor",
      operation: "enable-for-current-user",
      scope: "org",
    });
  });

  it("adds a global admin to the global rule when nothing is set yet", () => {
    const { enable } = render(
      flag({
        inEffect: "none",
        global: { state: "unset", canManage: true },
        org: { ...UNSET_ORG, canManage: false },
      }),
    );

    act(() => enable.click());
    expect(onMutate).toHaveBeenCalledWith({
      key: "new-editor",
      operation: "enable-for-current-user",
      scope: "global",
    });
  });
});
