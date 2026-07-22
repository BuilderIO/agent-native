// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useShareDialogController,
  type ResourceSharesResponse,
  type ShareDialogController,
  type ShareDialogControllerOptions,
} from "./useShareDialogController.js";

const mocks = vi.hoisted(() => ({
  query: {
    data: undefined as ResourceSharesResponse | undefined,
    isLoading: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  share: { mutate: vi.fn(), isPending: false },
  unshare: { mutate: vi.fn(), isPending: false },
  visibility: { mutate: vi.fn(), isPending: false },
  writeClipboardText: vi.fn(),
}));

vi.mock("../use-action.js", () => ({
  useActionQuery: vi.fn(() => mocks.query),
  useActionMutation: vi.fn((name: string) => {
    if (name === "share-resource") return mocks.share;
    if (name === "unshare-resource") return mocks.unshare;
    return mocks.visibility;
  }),
}));
vi.mock("../clipboard.js", () => ({
  writeClipboardText: mocks.writeClipboardText,
}));
vi.mock("../i18n.js", () => ({
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
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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
      root.render(<Harness {...nextOptions} />);
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
      { value: "invite", label: "share.invite" },
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
      { onSuccess: expect.any(Function) },
    );

    act(() => mocks.share.mutate.mock.calls[0]?.[1]?.onSuccess());
    expect((controller as ShareDialogController).invite.email).toBe("");
    expect(mocks.query.refetch).toHaveBeenCalledOnce();
  });

  it("gates mutations by role and refetches after permitted changes", async () => {
    const result = await render();
    const memberShare = mocks.query.data?.shares[0];

    act(() => result.visibility.set("org"));
    expect(mocks.visibility.mutate).toHaveBeenCalledWith(
      { resourceType: "document", resourceId: "doc-1", visibility: "org" },
      { onSuccess: expect.any(Function) },
    );
    act(() => result.removeShare(memberShare!));
    expect(mocks.unshare.mutate).toHaveBeenCalledWith(
      {
        resourceType: "document",
        resourceId: "doc-1",
        principalType: "user",
        principalId: "member@example.test",
      },
      { onSuccess: expect.any(Function) },
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
});
