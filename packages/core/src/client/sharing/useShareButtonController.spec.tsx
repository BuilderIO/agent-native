// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useShareButtonController,
  type ShareButtonController,
  type ShareButtonControllerOptions,
  type ShareButtonSharesResponse,
} from "./useShareButtonController.js";

const mocks = vi.hoisted(() => ({
  query: {
    data: undefined as ShareButtonSharesResponse | undefined,
    refetch: vi.fn(async () => undefined),
  },
  setVisibility: { mutate: vi.fn() },
  share: { mutate: vi.fn() },
  unshare: { mutate: vi.fn() },
}));

vi.mock("../use-action.js", () => ({
  useActionQuery: vi.fn(() => mocks.query),
  useActionMutation: vi.fn((name: string) => {
    if (name === "set-resource-visibility") return mocks.setVisibility;
    if (name === "share-resource") return mocks.share;
    return mocks.unshare;
  }),
}));

describe("useShareButtonController", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let controller: ShareButtonController | undefined;

  const options: ShareButtonControllerOptions = {
    resourceType: "document",
    resourceId: "doc-1",
  };

  function Harness(props: ShareButtonControllerOptions) {
    controller = useShareButtonController(props);
    return null;
  }

  async function render(
    nextOptions: ShareButtonControllerOptions = options,
  ): Promise<ShareButtonController> {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness {...nextOptions} />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    return controller as ShareButtonController;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ members: [] }),
      }),
    );
    mocks.query.data = {
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      visibility: "private",
      role: "owner",
      shares: [
        {
          id: "share-1",
          principalType: "user",
          principalId: "member@example.test",
          role: "viewer",
        },
      ],
    };
    mocks.query.refetch.mockClear();
    mocks.setVisibility.mutate.mockReset();
    mocks.share.mutate.mockReset();
    mocks.unshare.mutate.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
    controller = undefined;
  });

  it("guards rapid duplicate invites for the same principal", async () => {
    const result = await render();
    act(() => {
      result.setInviteEmail("member@example.test");
    });
    act(() => {
      (controller as ShareButtonController).handleAdd();
      (controller as ShareButtonController).handleAdd();
    });

    expect(mocks.share.mutate).toHaveBeenCalledTimes(1);
    expect((controller as ShareButtonController).inFlight).toEqual(
      new Set(["user:member@example.test"]),
    );
  });

  it("restores the exact cache snapshot when visibility fails", async () => {
    const initial: ShareButtonSharesResponse = {
      ...mocks.query.data!,
      shares: [...mocks.query.data!.shares],
    };
    queryClient.setQueryData(
      [
        "action",
        "list-resource-shares",
        { resourceType: "document", resourceId: "doc-1" },
      ],
      initial,
    );
    const result = await render();
    act(() => result.handleVisibility("org"));
    const callback = mocks.setVisibility.mutate.mock.calls[0]?.[1];
    await act(async () => {
      callback?.onError(new Error("visibility failed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    const restored = queryClient.getQueryData<ShareButtonSharesResponse>([
      "action",
      "list-resource-shares",
      { resourceType: "document", resourceId: "doc-1" },
    ]);
    expect(restored).toEqual(initial);
    expect((controller as ShareButtonController).visibilityOverride).toBeNull();
    expect((controller as ShareButtonController).shareError).toBe(
      "visibility failed",
    );
  });

  it("gates every sharing mutation for non-managers", async () => {
    mocks.query.data = { ...mocks.query.data!, role: "viewer" };
    const result = await render();
    const share = mocks.query.data.shares[0]!;
    act(() => {
      result.handleVisibility("org");
      result.setInviteEmail("new@example.test");
    });
    act(() => {
      (controller as ShareButtonController).handleAdd();
      (controller as ShareButtonController).handleChangeRole(share, "admin");
      (controller as ShareButtonController).handleRemove(share);
    });

    expect(mocks.setVisibility.mutate).not.toHaveBeenCalled();
    expect(mocks.share.mutate).not.toHaveBeenCalled();
    expect(mocks.unshare.mutate).not.toHaveBeenCalled();
    expect((controller as ShareButtonController).shareError).toBe(
      "Only owners and admins can change access.",
    );
    act(() => {
      (controller as ShareButtonController).handleOpenChange(false);
      (controller as ShareButtonController).handleOpenChange(true);
    });
    expect((controller as ShareButtonController).shareError).toBe(
      "Only owners and admins can change access.",
    );
  });

  it("keeps draft and pending state across close and reopen", async () => {
    const result = await render();
    act(() => {
      result.setRole("admin");
      result.setNotifyPeople(false);
      result.setInviteEmail("pending@example.test");
    });
    act(() => {
      (controller as ShareButtonController).handleAdd();
      (controller as ShareButtonController).handleOpenChange(false);
      (controller as ShareButtonController).handleOpenChange(true);
    });

    const reopened = controller as ShareButtonController;
    expect(reopened.role).toBe("admin");
    expect(reopened.notifyPeople).toBe(false);
    expect(reopened.inFlight).toEqual(new Set(["user:pending@example.test"]));
    expect(reopened.shares).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ principalId: "pending@example.test" }),
      ]),
    );
  });
});
