// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppKeysPanel } from "./app-keys-popover";

const queryState = vi.hoisted(() => ({
  refetchSecrets: vi.fn(),
  refetchGrants: vi.fn(),
  refetchAccess: vi.fn(),
  queryCalls: [] as Array<{ name: string; options?: { enabled?: boolean } }>,
  secretsError: new Error("Vault unavailable") as Error | null,
}));

const orgRoleState = vi.hoisted(() => ({
  org: { orgId: "org_123" },
  role: "owner" as "owner" | "admin" | "member",
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "dispatch.pages.dataLoadFailed": "Couldn't load data",
      "dispatch.pages.dataLoadFailedDescription":
        "Dispatch couldn't load this data.",
      "dispatch.pages.tryAgain": "Try again",
    })[key] ?? key,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (
    name: string,
    _args?: unknown,
    options?: { enabled?: boolean },
  ) => {
    queryState.queryCalls.push({ name, options });
    const queries = {
      "list-vault-secret-options": {
        data: undefined,
        isLoading: false,
        error: queryState.secretsError,
        refetch: queryState.refetchSecrets,
      },
      "list-vault-grants": {
        data: [],
        isLoading: false,
        error: null,
        refetch: queryState.refetchGrants,
      },
      "get-vault-access-settings": {
        data: undefined,
        isLoading: false,
        error: null,
        refetch: queryState.refetchAccess,
      },
    };
    return queries[name as keyof typeof queries];
  },
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgRole: () => orgRoleState,
}));

describe("AppKeysPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    queryState.queryCalls.length = 0;
    queryState.secretsError = new Error("Vault unavailable");
    orgRoleState.role = "owner";
    orgRoleState.isLoading = false;
    orgRoleState.error = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows a retryable error instead of an empty key list", () => {
    act(() => {
      root.render(<AppKeysPanel appId="mail" appName="Mail" />);
    });

    expect(container.textContent).toContain("Couldn't load data");
    expect(container.textContent).toContain(
      "Dispatch couldn't load this data.",
    );
    expect(container.textContent).not.toContain("Vault unavailable");
    expect(container.textContent).not.toContain("No vault keys yet");

    act(() => {
      container.querySelector("button")?.click();
    });
    expect(queryState.refetchSecrets).toHaveBeenCalledOnce();
    expect(queryState.refetchGrants).toHaveBeenCalledOnce();
    expect(queryState.refetchAccess).toHaveBeenCalledOnce();
  });

  it("does not request admin-only grants for workspace members", () => {
    orgRoleState.role = "member";
    queryState.secretsError = null;

    act(() => {
      root.render(
        <AppKeysPanel appId="retrospectives" appName="Retrospectives" />,
      );
    });

    const grantsQuery = queryState.queryCalls.find(
      (query) => query.name === "list-vault-grants",
    );
    expect(grantsQuery?.options).toEqual({ enabled: false });
    expect(container.textContent).toContain(
      "Only workspace owners and admins can manage keys.",
    );
    expect(container.textContent).not.toContain("Couldn't load data");
  });

  it("requests grants for workspace owners", () => {
    queryState.secretsError = null;

    act(() => {
      root.render(
        <AppKeysPanel appId="retrospectives" appName="Retrospectives" />,
      );
    });

    const grantsQuery = queryState.queryCalls.find(
      (query) => query.name === "list-vault-grants",
    );
    expect(grantsQuery?.options).toEqual({ enabled: true });
  });
});
