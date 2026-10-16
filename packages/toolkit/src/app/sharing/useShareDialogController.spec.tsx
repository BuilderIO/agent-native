// @vitest-environment happy-dom

import {
  useShareDialogController,
  type ResourceSharesResponse,
  type ShareDialogController,
  type ShareDialogControllerOptions,
} from "@agent-native/core/client/sharing/useShareDialogController";
import { ShareVisibilityNotSavedError } from "@agent-native/core/client/sharing/useShareVisibilityTransition";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: {
    data: undefined as ResourceSharesResponse | undefined,
    isLoading: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  share: { mutate: vi.fn(), isPending: false },
  unshare: { mutate: vi.fn(), isPending: false },
  visibility: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  writeClipboardText: vi.fn(),
}));

// The controllers settle each save through mutateAsync; the tests drive it
// through the callbacks recorded on `mutate`.
mocks.visibility.mutateAsync.mockImplementation(
  (variables: unknown) =>
    new Promise((resolve, reject) => {
      mocks.visibility.mutate(variables, {
        onSuccess: resolve,
        onError: reject,
      });
    }),
);

vi.mock("@agent-native/core/client/use-action", () => ({
  useActionQuery: vi.fn(() => mocks.query),
  useActionMutation: vi.fn((name: string) => {
    if (name === "share-resource") return mocks.share;
    if (name === "unshare-resource") return mocks.unshare;
    return mocks.visibility;
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) => {
    if (values?.title) return `${key}:${values.title}`;
    if (values?.type) return `${key}:${values.type}`;
    if (values?.name) return `${key}:${values.name}`;
    return key;
  },
}));

describe("useShareDialogController", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: ShareDialogController | undefined;
  let options: ShareDialogControllerOptions;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          members: [
            { email: "owner@example.test", name: "Ada Owner" },
            { email: "member@example.test", name: "Morgan Member" },
          ],
        }),
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
          role: "editor",
        },
        {
          id: "share-2",
          principalType: "org",
          principalId: "org-1",
          displayName: "Acme",
          role: "viewer",
        },
      ],
      policy: { allowPublic: true },
    };
    mocks.query.isLoading = false;
    mocks.query.error = null;
    mocks.share.isPending = false;
    mocks.unshare.isPending = false;
    mocks.visibility.isPending = false;
    mocks.writeClipboardText.mockResolvedValue(true);
    options = {
      open: true,
      onClose: vi.fn(),
      resourceType: "document",
      resourceId: "doc-1",
      resourceTitle: "Quarterly plan",
      shareUrl: "https://example.test/share/doc-1",
      embedUrl: "https://example.test/embed/doc-1",
      clipboardWriter: mocks.writeClipboardText,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
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

  function Harness(props: ShareDialogControllerOptions) {
    controller = useShareDialogController(props);
    return null;
  }

  async function render(
    nextOptions: ShareDialogControllerOptions = options,
  ): Promise<ShareDialogController> {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness {...nextOptions} />
        </QueryClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(controller).toBeDefined();
    return controller as ShareDialogController;
  }

  it("derives styling-agnostic tabs, labels, access, and people", async () => {
    const result = await render();

    expect(result.title).toBe("share.titleWithResource:Quarterly plan");
    expect(result.ownerLabel).toBe("share.owner:Ada Owner");
    expect(result.activeTab).toBe("link");
    expect(result.tabs).toEqual([
      { value: "link", label: "share.link" },
      { value: "embed", label: "share.embed" },
    ]);
    expect(result.canManage).toBe(true);
    expect(result.visibility).toMatchObject({
      value: "private",
      label: "share.private",
      description: "share.privateDescription",
      disabled: false,
    });
    expect(result.people).toEqual([
      expect.objectContaining({
        key: "owner:owner@example.test",
        label: "Ada Owner",
        roleLabel: "share.ownerRole",
        principalType: "owner",
        avatarText: "A",
      }),
      expect.objectContaining({
        key: "user:member@example.test",
        label: "Morgan Member",
        roleLabel: "Editor",
        avatarText: "M",
      }),
      expect.objectContaining({
        key: "org:org-1",
        label: "Acme",
        roleLabel: "Viewer",
        avatarText: null,
      }),
    ]);
    expect(result.embedCode).toContain(options.embedUrl);
  });

  it("owns invite state and preserves the shared action payload", async () => {
    let result = await render();

    act(() => {
      result.invite.setEmail("  person@example.test  ");
      result.invite.setRole("admin");
      result.invite.setNotifyPeople(false);
    });
    result = controller as ShareDialogController;

    expect(result.invite.showNotifyPeople).toBe(true);
    act(() => result.invite.submit());
    expect(mocks.share.mutate).toHaveBeenCalledWith(
      {
        resourceType: "document",
        resourceId: "doc-1",
        principalType: "user",
        principalId: "person@example.test",
        role: "admin",
        notify: false,
        resourceUrl: "https://example.test/share/doc-1",
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    act(() => mocks.share.mutate.mock.calls[0]?.[1]?.onSuccess());
    expect((controller as ShareDialogController).invite.email).toBe("");
    expect(mocks.query.refetch).toHaveBeenCalledOnce();
  });

  it("passes an optional message with an invite notification", async () => {
    let result = await render();

    act(() => {
      result.invite.setEmail("recipient@example.test");
      result.invite.setMessage("Here is the latest version.");
      result.invite.setMessageOpen(true);
    });
    result = controller as ShareDialogController;
    act(() => result.invite.submit());

    expect(mocks.share.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: "recipient@example.test",
        notify: true,
        message: "Here is the latest version.",
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("gates mutations by role and refetches after permitted changes", async () => {
    const result = await render();
    const memberShare = mocks.query.data?.shares[0];

    act(() => result.visibility.set("org"));
    expect(mocks.visibility.mutate).not.toHaveBeenCalled();
    act(() => {
      void (
        controller as ShareDialogController
      ).visibility.transition.confirm();
    });
    expect(mocks.visibility.mutate).toHaveBeenCalledWith(
      { resourceType: "document", resourceId: "doc-1", visibility: "org" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    act(() => result.removeShare(memberShare!));
    expect(mocks.unshare.mutate).toHaveBeenCalledWith(
      {
        resourceType: "document",
        resourceId: "doc-1",
        principalType: "user",
        principalId: "member@example.test",
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    mocks.query.data = { ...mocks.query.data!, role: "viewer" };
    const viewer = await render();
    act(() => {
      viewer.visibility.set("public");
      viewer.removeShare(memberShare!);
      viewer.invite.setEmail("new@example.test");
    });
    act(() => (controller as ShareDialogController).invite.submit());
    expect(mocks.visibility.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.unshare.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.share.mutate).not.toHaveBeenCalled();
  });

  it("does not refetch after a visibility mutation is superseded", async () => {
    let result = await render();

    act(() => result.visibility.set("public"));
    result = controller as ShareDialogController;
    act(() => result.visibility.set("org"));

    act(() => mocks.visibility.mutate.mock.calls[0]?.[1]?.onSuccess());
    expect(mocks.query.refetch).not.toHaveBeenCalled();

    await act(async () => {
      mocks.visibility.mutate.mock.calls[1]?.[1]?.onSuccess();
      await Promise.resolve();
    });
    expect(mocks.query.refetch).toHaveBeenCalledOnce();
  });

  it("honors restricted public policy while retaining an existing public value", async () => {
    mocks.query.data = {
      ...mocks.query.data!,
      policy: { allowPublic: false },
    };
    expect(
      (await render()).visibility.options.map(({ value }) => value),
    ).toEqual(["private", "org"]);

    mocks.query.data = { ...mocks.query.data, visibility: "public" };
    expect(
      (await render()).visibility.options.map(({ value }) => value),
    ).toEqual(["private", "org", "public"]);
  });

  it("does not fetch shares or org members while closed", async () => {
    const { useActionQuery } =
      await import("@agent-native/core/client/use-action");
    await render({ ...options, open: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(useActionQuery).toHaveBeenLastCalledWith(
      "list-resource-shares",
      expect.anything(),
      { enabled: false },
    );

    await render(options);
    const fetched = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(fetched.filter((url) => url.includes("/org/members"))).toHaveLength(
      1,
    );
    expect(fetched.filter((url) => url.endsWith("/org/me"))).toHaveLength(1);
    expect(useActionQuery).toHaveBeenLastCalledWith(
      "list-resource-shares",
      expect.anything(),
      { enabled: true },
    );
  });

  it("resets tab state when opened and delegates close transitions", async () => {
    let result = await render({ ...options, open: false });
    act(() => result.setActiveTab("invite"));
    expect((controller as ShareDialogController).activeTab).toBe("invite");

    result = await render(options);
    expect(result.activeTab).toBe("link");
    act(() => result.onOpenChange(false));
    expect(options.onClose).toHaveBeenCalledOnce();
  });

  it("owns copy feedback without exposing a clipboard implementation", async () => {
    vi.useFakeTimers();
    const result = await render();

    await act(async () => {
      await result.copy("share-link", options.shareUrl!);
    });
    expect(mocks.writeClipboardText).toHaveBeenCalledWith(options.shareUrl);
    expect((controller as ShareDialogController).copiedField).toBe(
      "share-link",
    );

    act(() => vi.advanceTimersByTime(1_400));
    expect((controller as ShareDialogController).copiedField).toBeNull();
    vi.useRealTimers();
  });

  it("rolls back failed mutations and exposes a normalized error", async () => {
    const initial = {
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
    let result = await render();
    act(() => result.invite.setEmail("new@example.test"));
    result = controller as ShareDialogController;
    act(() => result.invite.submit());
    await act(async () => {
      mocks.share.mutate.mock.calls[0]?.[1]?.onError(
        new Error("Action share-resource failed: invite denied"),
      );
      await Promise.resolve();
    });

    expect((controller as ShareDialogController).error).toBe("invite denied");
    expect((controller as ShareDialogController).invite.email).toBe(
      "new@example.test",
    );
    expect(
      queryClient.getQueryData([
        "action",
        "list-resource-shares",
        { resourceType: "document", resourceId: "doc-1" },
      ]),
    ).toEqual(initial);
  });

  describe("organization confirmation", () => {
    const sharesKey = [
      "action",
      "list-resource-shares",
      { resourceType: "document", resourceId: "doc-1" },
    ] as const;

    const transition = () =>
      (controller as ShareDialogController).visibility.transition;

    it("holds a private-to-organization change until it is confirmed", async () => {
      const initial = { ...mocks.query.data! };
      queryClient.setQueryData(sharesKey, initial);
      const result = await render();

      act(() => result.visibility.set("org"));

      expect(transition().pending).toEqual({ from: "private", to: "org" });
      expect(mocks.visibility.mutate).not.toHaveBeenCalled();
      expect(queryClient.getQueryData(sharesKey)).toEqual(initial);
      expect((controller as ShareDialogController).visibility.value).toBe(
        "private",
      );
    });

    it("leaves the saved access and cache alone on cancel", async () => {
      const initial = { ...mocks.query.data! };
      queryClient.setQueryData(sharesKey, initial);
      const result = await render();
      act(() => result.visibility.set("org"));

      act(() => transition().cancel());

      expect(transition().pending).toBeNull();
      expect(mocks.visibility.mutate).not.toHaveBeenCalled();
      expect(queryClient.getQueryData(sharesKey)).toEqual(initial);
    });

    it("saves once on confirm and closes after success", async () => {
      const result = await render();
      act(() => result.visibility.set("org"));

      await act(async () => {
        void transition().confirm();
        void transition().confirm();
      });
      expect(mocks.visibility.mutate).toHaveBeenCalledOnce();
      expect(transition().submitting).toBe(true);

      await act(async () => {
        mocks.visibility.mutate.mock.calls[0]?.[1]?.onSuccess({
          visibility: "org",
        });
        await Promise.resolve();
      });
      expect(transition().pending).toBeNull();
      expect(transition().submitting).toBe(false);
    });

    it("keeps the confirmation open with the error and retries after a failure", async () => {
      const initial = { ...mocks.query.data! };
      queryClient.setQueryData(sharesKey, initial);
      const result = await render();
      act(() => result.visibility.set("org"));
      await act(async () => {
        void transition().confirm();
      });

      await act(async () => {
        mocks.visibility.mutate.mock.calls[0]?.[1]?.onError(
          new Error("visibility failed"),
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(transition().pending).toEqual({ from: "private", to: "org" });
      expect(transition().error).toBe("visibility failed");
      expect(transition().submitting).toBe(false);
      expect(queryClient.getQueryData(sharesKey)).toEqual(initial);
      expect((controller as ShareDialogController).error).toBeNull();

      await act(async () => {
        void transition().confirm();
      });
      expect(mocks.visibility.mutate).toHaveBeenCalledTimes(2);
      expect(transition().error).toBeNull();
    });

    it("rejects a superseded write that failed without showing it as the current error", async () => {
      mocks.query.data = { ...mocks.query.data!, visibility: "public" };
      const result = await render();
      let older!: Promise<void>;
      act(() => {
        older = result.visibility.transition.request("org");
      });
      act(() =>
        (controller as ShareDialogController).visibility.set("private"),
      );
      expect(mocks.visibility.mutate).toHaveBeenCalledTimes(2);

      await act(async () => {
        mocks.visibility.mutate.mock.calls[0]?.[1]?.onError(
          new Error("stale write failed"),
        );
        await expect(older).rejects.toThrow("stale write failed");
      });

      expect((controller as ShareDialogController).error).toBeNull();
    });

    it("drops the request when the resource changes or access is lost", async () => {
      const result = await render();
      act(() => result.visibility.set("org"));
      expect(transition().pending).not.toBeNull();

      await render({ ...options, resourceId: "doc-2" });
      expect(transition().pending).toBeNull();

      act(() => (controller as ShareDialogController).visibility.set("org"));
      expect(transition().pending).not.toBeNull();
      mocks.query.data = { ...mocks.query.data!, role: "viewer" };
      await render({ ...options, resourceId: "doc-2" });
      expect(transition().pending).toBeNull();
      await act(async () => {
        await transition().confirm();
      });
      expect(mocks.visibility.mutate).not.toHaveBeenCalled();
    });

    it("does not confirm after the saved value moved or the dialog closed", async () => {
      const result = await render();
      act(() => result.visibility.set("org"));
      const staleConfirm = transition().confirm;

      mocks.query.data = { ...mocks.query.data!, visibility: "org" };
      await render();
      await act(async () => {
        await staleConfirm();
      });
      expect(mocks.visibility.mutate).not.toHaveBeenCalled();

      mocks.query.data = { ...mocks.query.data!, visibility: "private" };
      await render();
      act(() => (controller as ShareDialogController).visibility.set("org"));
      const closedConfirm = transition().confirm;
      await render({ ...options, open: false });
      await act(async () => {
        await closedConfirm();
      });
      expect(mocks.visibility.mutate).not.toHaveBeenCalled();
    });

    it("does not carry a pending change from one resource into the next", async () => {
      await render();
      act(() => (controller as ShareDialogController).visibility.set("public"));
      expect(mocks.visibility.mutate).toHaveBeenCalledTimes(1);
      expect((controller as ShareDialogController).visibility.value).toBe(
        "public",
      );

      await render({ ...options, resourceId: "doc-2" });
      expect((controller as ShareDialogController).visibility.value).toBe(
        "private",
      );

      act(() => (controller as ShareDialogController).visibility.set("org"));
      expect(transition().pending).toEqual({ from: "private", to: "org" });
      expect(mocks.visibility.mutate).toHaveBeenCalledTimes(1);

      await act(async () => {
        mocks.visibility.mutate.mock.calls[0]?.[1]?.onSuccess({
          visibility: "public",
        });
        await Promise.resolve();
      });
      expect(transition().pending).toEqual({ from: "private", to: "org" });
      expect((controller as ShareDialogController).visibility.value).toBe(
        "private",
      );

      await act(async () => {
        void transition().confirm();
      });
      expect(mocks.visibility.mutate).toHaveBeenCalledTimes(2);
      expect(mocks.visibility.mutate.mock.calls[1]?.[0]).toMatchObject({
        resourceId: "doc-2",
        visibility: "org",
      });
    });

    it("settles a request only when it is persisted, rejects it otherwise", async () => {
      await render();
      let saved!: Promise<void>;
      act(() => {
        saved = transition().request("public");
      });
      await act(async () => {
        mocks.visibility.mutate.mock.calls[0]?.[1]?.onError(
          new Error("visibility failed"),
        );
        await expect(saved).rejects.toThrow("visibility failed");
      });

      mocks.visibility.mutate.mockClear();
      let held!: Promise<void>;
      act(() => {
        held = transition().request("org");
      });
      act(() => transition().cancel());
      await expect(held).rejects.toBeInstanceOf(ShareVisibilityNotSavedError);
      expect(mocks.visibility.mutate).not.toHaveBeenCalled();
    });

    it("keeps a held request pending through a failed confirmation until a retry saves", async () => {
      await render();
      let settled: "pending" | "saved" | "rejected" = "pending";
      act(() => {
        void transition()
          .request("org")
          .then(
            () => {
              settled = "saved";
            },
            () => {
              settled = "rejected";
            },
          );
      });
      await act(async () => {
        void transition().confirm();
      });
      await act(async () => {
        mocks.visibility.mutate.mock.calls[0]?.[1]?.onError(new Error("nope"));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(transition().error).toBe("nope");
      expect(settled).toBe("pending");

      await act(async () => {
        void transition().confirm();
      });
      await act(async () => {
        mocks.visibility.mutate.mock.calls[1]?.[1]?.onSuccess({
          visibility: "org",
        });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(settled).toBe("saved");
    });

    it("joins a repeated request for a value that is still being saved", async () => {
      await render();
      let first!: Promise<void>;
      act(() => {
        first = transition().request("public");
      });
      let second!: Promise<void>;
      act(() => {
        second = (
          controller as ShareDialogController
        ).visibility.transition.request("public");
      });
      expect(mocks.visibility.mutate).toHaveBeenCalledTimes(1);

      await act(async () => {
        mocks.visibility.mutate.mock.calls[0]?.[1]?.onError(
          new Error("visibility failed"),
        );
        await expect(first).rejects.toThrow("visibility failed");
        await expect(second).rejects.toThrow("visibility failed");
      });
    });

    it("ignores a visibility request from a closed dialog", async () => {
      await render({ ...options, open: false });

      act(() => (controller as ShareDialogController).visibility.set("public"));
      act(() => (controller as ShareDialogController).visibility.set("org"));

      expect(mocks.visibility.mutate).not.toHaveBeenCalled();
      expect(transition().pending).toBeNull();
    });

    it("does not ask for narrowing or for private-to-public changes", async () => {
      mocks.query.data = { ...mocks.query.data!, visibility: "public" };
      const result = await render();
      act(() => result.visibility.set("org"));
      expect(transition().pending).toBeNull();
      expect(mocks.visibility.mutate).toHaveBeenCalledTimes(1);

      mocks.visibility.mutate.mockClear();
      mocks.query.data = { ...mocks.query.data!, visibility: "private" };
      const priv = await render();
      act(() => priv.visibility.set("public"));
      expect(transition().pending).toBeNull();
      expect(mocks.visibility.mutate).toHaveBeenCalledTimes(1);
    });
  });
});
