// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {
    isLoading: false,
    isError: false,
    data: { configured: false },
    refetch: vi.fn(),
  },
  action: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  queryClient: { setQueryData: vi.fn(), invalidateQueries: vi.fn() },
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.action,
  getBrowserTabId: () => "test",
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appBasePath: () => "",
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/shared", () => ({ AgentMark: () => null }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));
vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ search: "?spaceId=space-1&folderId=folder-1" }),
  Link: ({ children }: React.PropsWithChildren) => <a>{children}</a>,
}));
vi.mock("@/hooks/use-video-storage-status", () => ({
  useVideoStorageStatus: () => mocks.storage,
  VIDEO_STORAGE_STATUS_KEY: ["storage"],
}));
vi.mock("@/hooks/use-upload-video-picker", () => ({
  useUploadVideoPicker: () => ({ input: null, openUploadPicker: vi.fn() }),
}));
vi.mock("@/hooks/use-sonner-lifecycle-toast", () => ({
  useSonnerLifecycleToast: () => ({
    error: mocks.toast,
    info: mocks.toast,
    start: mocks.toast,
    success: mocks.toast,
  }),
}));
vi.mock("@/components/recorder/storage-setup-card", () => ({
  StorageSetupCard: () => <div data-storage-setup />,
}));
vi.mock("@/components/recorder/storage-status-retry", () => ({
  StorageStatusRetry: () => <div data-storage-retry />,
}));

import ImportRoute from "./import";

describe("import route storage gate", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    mocks.storage.isLoading = false;
    mocks.storage.isError = false;
    mocks.storage.data.configured = false;
    mocks.action
      .mockReset()
      .mockResolvedValue({ recordingId: "youtube-1", provider: "youtube" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<ImportRoute />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  function enter(url: string) {
    act(() => {
      const input = container.querySelector("input")!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, url);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function submit() {
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
  }
  it.each(["none", "loading", "error"])(
    "imports YouTube while storage is %s",
    async (state) => {
      mocks.storage.isLoading = state === "loading";
      mocks.storage.isError = state === "error";
      enter("https://www.youtube.com/watch?v=jNQXAC9IVRw");
      expect(
        container.querySelector<HTMLButtonElement>('button[type="submit"]')!
          .disabled,
      ).toBe(false);
      expect(
        container.querySelector("[data-storage-setup], [data-storage-retry]"),
      ).toBeNull();
      await submit();
      expect(mocks.action).toHaveBeenCalledWith("import-loom-recording", {
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        spaceIds: ["space-1"],
        folderId: "folder-1",
      });
    },
  );
  it.each(["loading", "error"])(
    "keeps native imports blocked with cached configured storage during %s",
    async (state) => {
      mocks.storage.data.configured = true;
      mocks.storage.isLoading = state === "loading";
      mocks.storage.isError = state === "error";
      enter("https://example.com/video.mp4");
      expect(
        container.querySelector<HTMLButtonElement>('button[type="submit"]')!
          .disabled,
      ).toBe(true);
      await submit();
      expect(mocks.action).not.toHaveBeenCalled();
      if (state === "error")
        expect(container.querySelector("[data-storage-retry]")).not.toBeNull();
    },
  );
  it.each([
    "https://www.loom.com/share/abcdefgh",
    "https://example.com/video.mp4",
  ])(
    "keeps the storage gate for %s, including after changing from YouTube",
    async (url) => {
      enter("https://youtu.be/jNQXAC9IVRw");
      enter(url);
      expect(container.querySelector("[data-storage-setup]")).not.toBeNull();
      expect(
        container.querySelector<HTMLButtonElement>('button[type="submit"]')!
          .disabled,
      ).toBe(true);
      await submit();
      expect(mocks.action).not.toHaveBeenCalled();
      mocks.storage.data.configured = true;
      act(() => root.render(<ImportRoute />));
      expect(container.querySelector("[data-storage-setup]")).toBeNull();
      await submit();
      expect(mocks.action).toHaveBeenCalledWith(
        "import-loom-recording",
        expect.objectContaining({ url }),
      );
    },
  );
});
