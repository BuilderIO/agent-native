// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useShareDialogController,
  type ResourceSharesResponse,
  type ShareDialogController,
} from "./useShareDialogController.js";

const mocks = vi.hoisted(() => ({
  query: {
    data: undefined as ResourceSharesResponse | undefined,
    isLoading: false,
    error: null as unknown,
    refetch: vi.fn(async () => undefined),
  },
  visibility: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  other: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
}));

vi.mock("../use-action.js", () => ({
  useActionQuery: vi.fn(() => mocks.query),
  useActionMutation: vi.fn((name: string) =>
    name === "set-resource-visibility" ? mocks.visibility : mocks.other,
  ),
}));

vi.mock("../i18n.js", () => ({
  useT: () => (key: string) => key,
}));

describe("useShareDialogController organization confirmation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: ShareDialogController | undefined;
  let queryClient: QueryClient;

  function Harness() {
    controller = useShareDialogController({
      open: true,
      onClose: () => undefined,
      resourceType: "document",
      resourceId: "doc-1",
    });
    return null;
  }

  async function render(policy: ResourceSharesResponse["policy"]) {
    mocks.query.data = {
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      visibility: "private",
      role: "owner",
      shares: [],
      policy,
    } as ResourceSharesResponse;
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    if (!controller) throw new Error("The controller did not render");
    return controller;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ members: [], orgId: "org-1", orgs: [] }),
      }),
    );
    mocks.visibility.mutateAsync.mockResolvedValue({ visibility: "org" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    controller = undefined;
  });

  it("saves private to organization at once for a type that does not ask", async () => {
    const result = await render({ allowPublic: true });

    await act(async () => {
      result.visibility.set("org");
      await Promise.resolve();
    });

    expect(mocks.visibility.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "org" }),
    );
    expect(controller?.visibility.transition.pending).toBeNull();
  });

  it("holds private to organization for a type that asks", async () => {
    const result = await render({
      allowPublic: true,
      confirmOrgVisibility: true,
    });

    act(() => result.visibility.set("org"));

    expect(mocks.visibility.mutateAsync).not.toHaveBeenCalled();
    expect(controller?.visibility.transition.pending).toEqual({
      from: "private",
      to: "org",
    });
  });
});
