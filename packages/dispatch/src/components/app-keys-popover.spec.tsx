// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppKeysPanel } from "./app-keys-popover";

const queryState = vi.hoisted(() => ({
  refetchSecrets: vi.fn(),
  refetchGrants: vi.fn(),
  refetchAccess: vi.fn(),
}));

vi.mock("@agent-native/core/client", () => ({
  useT: () => (key: string) =>
    ({
      "dispatch.pages.dataLoadFailed": "Couldn't load data",
      "dispatch.pages.dataLoadFailedDescription":
        "Dispatch couldn't load this data.",
      "dispatch.pages.tryAgain": "Try again",
    })[key] ?? key,
  useActionQuery: (name: string) => {
    const queries = {
      "list-vault-secret-options": {
        data: undefined,
        isLoading: false,
        error: new Error("Vault unavailable"),
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

describe("AppKeysPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
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
});
