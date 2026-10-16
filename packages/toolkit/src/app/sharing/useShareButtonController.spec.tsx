// @vitest-environment happy-dom

import {
  useShareButtonController,
  type ShareButtonController,
  type ShareButtonControllerOptions,
  type ShareButtonSharesResponse,
  type ShareButtonVisibility,
} from "@agent-native/core/client/sharing/useShareButtonController";
import { ShareVisibilityNotSavedError } from "@agent-native/core/client/sharing/useShareVisibilityTransition";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useActionQuery: vi.fn(),
  query: {
    data: undefined as ShareButtonSharesResponse | undefined,
    refetch: vi.fn(async () => undefined),
  },
  setVisibility: { mutate: vi.fn(), mutateAsync: vi.fn() },
  share: { mutate: vi.fn() },
  unshare: { mutate: vi.fn() },
}));

// The controllers settle each save through mutateAsync; the tests drive it
// through the callbacks recorded on `mutate`.
mocks.setVisibility.mutateAsync.mockImplementation(
  (variables: unknown) =>
    new Promise((resolve, reject) => {
      mocks.setVisibility.mutate(variables, {
        onSuccess: resolve,
        onError: reject,
      });
    }),
);

vi.mock("@agent-native/core/client/use-action", () => ({
  useActionQuery: mocks.useActionQuery,
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

  async function renderOpen(
    nextOptions: ShareButtonControllerOptions = options,
  ): Promise<ShareButtonController> {
    const result = await render(nextOptions);
    act(() => result.handleOpenChange(true));
    return controller as ShareButtonController;
  }

  function chooseVisibility(next: ShareButtonVisibility) {
    act(() => (controller as ShareButtonController).handleVisibility(next));
    if ((controller as ShareButtonController).visibilityTransition.pending) {
      act(() => {
        void (
          controller as ShareButtonController
        ).visibilityTransition.confirm();
      });
    }
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
    mocks.useActionQuery.mockReset().mockReturnValue(mocks.query);
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

  it("loads share state only while the popover is open", async () => {
    const result = await render();
    const latestShareQueryOptions = () =>
      mocks.useActionQuery.mock.calls
        .filter(([name]) => name === "list-resource-shares")
        .at(-1)?.[2];

    expect(latestShareQueryOptions()).toEqual({
      enabled: false,
      staleTime: 0,
    });
    expect(mocks.query.refetch).not.toHaveBeenCalled();

    act(() => result.handleOpenChange(true));

    expect(latestShareQueryOptions()).toEqual({
      enabled: true,
      staleTime: 0,
    });
    expect(mocks.query.refetch).not.toHaveBeenCalled();
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

  it("passes an optional message only with a notification", async () => {
    const result = await render();
    act(() => {
      result.setInviteEmail("recipient@example.test");
      result.setShareMessage("Here is the latest version.");
      result.setMessageOpen(true);
    });
    act(() => (controller as ShareButtonController).handleAdd());

    expect(mocks.share.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: "recipient@example.test",
        notify: true,
        message: "Here is the latest version.",
      }),
      expect.any(Object),
    );

    mocks.share.mutate.mockReset();
    act(() => {
      result.setInviteEmail("silent@example.test");
      result.setNotifyPeople(false);
      result.setShareMessage("This should not be sent.");
    });
    act(() => (controller as ShareButtonController).handleAdd());

    expect(mocks.share.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: "silent@example.test",
        notify: false,
      }),
      expect.any(Object),
    );
    expect(mocks.share.mutate.mock.calls[0]?.[0]).not.toHaveProperty("message");
  });

  it("reports a successfully added share to its host", async () => {
    const onShareSuccess = vi.fn();
    const result = await render({ ...options, onShareSuccess });
    act(() => result.setInviteEmail("new-member@example.test"));
    act(() => (controller as ShareButtonController).handleAdd());

    const mutation = mocks.share.mutate.mock.calls[0]?.[1];
    act(() => mutation?.onSuccess?.());

    expect(onShareSuccess).toHaveBeenCalledOnce();
  });

  it("does not report an update to an existing share as a first share", async () => {
    const onShareSuccess = vi.fn();
    const result = await render({ ...options, onShareSuccess });
    act(() => result.setInviteEmail("member@example.test"));
    act(() => (controller as ShareButtonController).handleAdd());

    const mutation = mocks.share.mutate.mock.calls[0]?.[1];
    act(() => mutation?.onSuccess?.({ updated: true }));

    expect(onShareSuccess).not.toHaveBeenCalled();
  });

  it("reports a private plan becoming shared to its host", async () => {
    const onShareSuccess = vi.fn();
    await renderOpen({ ...options, onShareSuccess });
    chooseVisibility("org");

    const mutation = mocks.setVisibility.mutate.mock.calls[0]?.[1];
    await act(async () => {
      mutation?.onSuccess?.({ visibility: "org" });
      await Promise.resolve();
    });

    expect(onShareSuccess).toHaveBeenCalledOnce();
  });

  it("reports the actual private-to-shared save once after refusing a different target", async () => {
    const onShareSuccess = vi.fn();
    await renderOpen({ ...options, onShareSuccess });
    chooseVisibility("public");
    const mutation = mocks.setVisibility.mutate.mock.calls[0]?.[1];
    chooseVisibility("org");
    expect(mocks.setVisibility.mutate).toHaveBeenCalledOnce();
    expect((controller as ShareButtonController).visibility).toBe("public");
    expect(onShareSuccess).not.toHaveBeenCalled();

    await act(async () => {
      mutation?.onSuccess?.({ visibility: "public" });
      await Promise.resolve();
    });

    expect(onShareSuccess).toHaveBeenCalledOnce();
  });

  it("requires an authoritative shared result after refusing a different target", async () => {
    const onShareSuccess = vi.fn();
    await renderOpen({ ...options, onShareSuccess });
    chooseVisibility("public");
    const mutation = mocks.setVisibility.mutate.mock.calls[0]?.[1];
    chooseVisibility("org");
    expect(mocks.setVisibility.mutate).toHaveBeenCalledOnce();

    await act(async () => {
      mutation?.onSuccess?.({ visibility: "private" });
      await Promise.resolve();
    });

    expect(onShareSuccess).not.toHaveBeenCalled();
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
    await renderOpen();
    chooseVisibility("org");
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
    expect(
      (controller as ShareButtonController).visibilityTransition.error,
    ).toBe("visibility failed");
    expect(
      (controller as ShareButtonController).visibilityTransition.pending,
    ).toEqual({ from: "private", to: "org" });
  });

  it("restores the sequence snapshot and refetches when the latest visibility update fails", async () => {
    const initial: ShareButtonSharesResponse = {
      ...mocks.query.data!,
      shares: [...mocks.query.data!.shares],
    };
    const shareQueryKey = [
      "action",
      "list-resource-shares",
      { resourceType: "document", resourceId: "doc-1" },
    ] as const;
    queryClient.setQueryData(shareQueryKey, initial);
    await renderOpen();
    chooseVisibility("public");
    const firstMutation = mocks.setVisibility.mutate.mock.calls[0]?.[1];
    chooseVisibility("org");
    const latestMutation = mocks.setVisibility.mutate.mock.calls[1]?.[1];

    await act(async () => {
      firstMutation?.onError(new Error("stale visibility failure"));
      latestMutation?.onError(new Error("latest visibility failure"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(queryClient.getQueryData(shareQueryKey)).toEqual(initial);
    expect(mocks.query.refetch).toHaveBeenCalled();
    expect((controller as ShareButtonController).visibilityOverride).toBeNull();
    expect((controller as ShareButtonController).visibility).toBe("private");
  });

  it("keeps the deprecated handleVisibilityChange behind the confirmation", async () => {
    await renderOpen();

    act(() => {
      void (controller as ShareButtonController).handleVisibilityChange("org");
    });

    expect(mocks.setVisibility.mutate).not.toHaveBeenCalled();
    expect(
      (controller as ShareButtonController).visibilityTransition.pending,
    ).toEqual({ from: "private", to: "org" });
  });

  it("resolves the deprecated alias only once a direct change is persisted", async () => {
    await renderOpen();
    let settled = false;
    let alias!: Promise<void>;
    act(() => {
      alias = (controller as ShareButtonController)
        .handleVisibilityChange("public")
        .then(() => {
          settled = true;
        });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(settled).toBe(false);

    await act(async () => {
      mocks.setVisibility.mutate.mock.calls[0]?.[1]?.onSuccess({
        visibility: "public",
      });
      await alias;
    });
    expect(settled).toBe(true);
  });

  it("rejects the deprecated alias when a direct change fails", async () => {
    await renderOpen();
    let alias!: Promise<void>;
    act(() => {
      alias = (controller as ShareButtonController).handleVisibilityChange(
        "public",
      );
    });

    await act(async () => {
      mocks.setVisibility.mutate.mock.calls[0]?.[1]?.onError(
        new Error("visibility failed"),
      );
      await expect(alias).rejects.toThrow("visibility failed");
    });
  });

  it("keeps a held alias change unresolved until confirmed and rejects it when cancelled", async () => {
    await renderOpen();
    const transition = () =>
      (controller as ShareButtonController).visibilityTransition;
    let confirmed = false;
    let alias!: Promise<void>;
    act(() => {
      alias = (controller as ShareButtonController)
        .handleVisibilityChange("org")
        .then(() => {
          confirmed = true;
        });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(confirmed).toBe(false);

    await act(async () => {
      void transition().confirm();
    });
    await act(async () => {
      mocks.setVisibility.mutate.mock.calls[0]?.[1]?.onSuccess({
        visibility: "org",
      });
      await alias;
    });
    expect(confirmed).toBe(true);

    mocks.setVisibility.mutate.mockReset();
    mocks.query.data = { ...mocks.query.data!, visibility: "private" };
    await render();
    let cancelled!: Promise<void>;
    act(() => {
      cancelled = (controller as ShareButtonController).handleVisibilityChange(
        "org",
      );
    });
    act(() => transition().cancel());
    await expect(cancelled).rejects.toBeInstanceOf(
      ShareVisibilityNotSavedError,
    );
    expect(mocks.setVisibility.mutate).not.toHaveBeenCalled();
  });

  it("does not carry a pending change from one resource into the next", async () => {
    mocks.query.data = { ...mocks.query.data!, visibility: "private" };
    await renderOpen();
    act(() => (controller as ShareButtonController).handleVisibility("public"));
    expect(mocks.setVisibility.mutate).toHaveBeenCalledTimes(1);
    expect((controller as ShareButtonController).visibility).toBe("public");

    // The mounted controller moves to another resource while the first write
    // is still in flight.
    await render({ ...options, resourceId: "doc-2" });
    expect((controller as ShareButtonController).visibility).toBe("private");
    expect((controller as ShareButtonController).visibilityOverride).toBeNull();

    act(() => (controller as ShareButtonController).handleVisibility("org"));
    expect(
      (controller as ShareButtonController).visibilityTransition.pending,
    ).toEqual({ from: "private", to: "org" });
    expect(mocks.setVisibility.mutate).toHaveBeenCalledTimes(1);

    // The first resource's write finishes late: it neither clears nor
    // confirms anything for the second one.
    await act(async () => {
      mocks.setVisibility.mutate.mock.calls[0]?.[1]?.onSuccess({
        visibility: "public",
      });
      await Promise.resolve();
    });
    expect(
      (controller as ShareButtonController).visibilityTransition.pending,
    ).toEqual({ from: "private", to: "org" });
    expect((controller as ShareButtonController).visibility).toBe("private");

    await act(async () => {
      void (controller as ShareButtonController).visibilityTransition.confirm();
    });
    expect(mocks.setVisibility.mutate).toHaveBeenCalledTimes(2);
    expect(mocks.setVisibility.mutate.mock.calls[1]?.[0]).toMatchObject({
      resourceId: "doc-2",
      visibility: "org",
    });
  });

  it("ignores visibility requests while the surface is closed", async () => {
    const result = await render();

    act(() => result.handleVisibility("public"));
    act(() => result.handleVisibility("org"));

    expect(mocks.setVisibility.mutate).not.toHaveBeenCalled();
    expect(
      (controller as ShareButtonController).visibilityTransition.pending,
    ).toBeNull();
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
