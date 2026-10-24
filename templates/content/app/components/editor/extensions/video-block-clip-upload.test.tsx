// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  clipsOn: true,
  storage: undefined as unknown,
  storageError: null as unknown,
  queryOptions: {} as Record<string, { resources?: readonly string[] }>,
  mutationOptions: {} as Record<string, { resources?: readonly string[] }>,
  callAction: vi.fn(),
  uploadVideoFile: vi.fn(),
  beginClipUpload: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key,
}));

vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => ({
    isSuccess: true,
    isError: false,
    isFetching: false,
    data: { configured: true },
    refetch: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => state.clipsOn,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: (
    name: string,
    options: { resources?: readonly string[] },
  ) => {
    state.mutationOptions[name] = options;
    return {
      mutateAsync: (variables: unknown) => state.callAction(name, variables),
    };
  },
  useActionQuery: (
    name: string,
    _params: unknown,
    options: { resources?: readonly string[] },
  ) => {
    state.queryOptions[name] = options;
    return name === "get-clips-links"
      ? {
          data: {
            appUrl: "https://clips.example.test",
            linkOrigins: ["https://clips.example.test"],
          },
          isSuccess: true,
        }
      : name === "get-clip-upload-status" && state.storageError
        ? {
            data: undefined,
            isSuccess: false,
            isError: true,
            error: state.storageError,
          }
        : name === "get-clip-upload-status" && state.storage
          ? { data: { storage: state.storage }, isSuccess: true }
          : { data: undefined, isSuccess: false };
  },
  callAction: state.callAction,
  getBrowserTabId: () => "tab_1",
  setClientAppState: vi.fn(),
}));

vi.mock("../image-upload", () => ({
  uploadVideoFile: state.uploadVideoFile,
  videoUploadErrorMessage: () => "upload failed",
}));

vi.mock("@/components/editor/clip-embed/clip-uploads", async (original) => ({
  ...(await original<
    typeof import("@/components/editor/clip-embed/clip-uploads")
  >()),
  beginClipUpload: state.beginClipUpload,
}));

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    NodeViewWrapper: ({ children, ...props }: Record<string, unknown>) =>
      createElement("div", props, children as React.ReactNode),
  };
});

import { holdDroppedClipFile } from "@/components/editor/clip-embed/clip-uploads";
import { TooltipProvider } from "@/components/ui/tooltip";

import { VideoBlock } from "./VideoBlock";

const ticket = {
  status: "started" as const,
  recordingId: "rec_1",
  chunkUrl:
    "https://clips.example.test/api/uploads/rec_1/content-chunk?ticket=t",
  chunkSizeBytes: 3,
  totalChunks: 2,
  expiresAt: "2026-10-24T12:00:00.000Z",
};

function video(name = "demo.mp4", type = "video/mp4") {
  return new File([new Uint8Array([1, 2, 3, 4, 5])], name, { type });
}

let root: Root;
let container: HTMLDivElement;
let inserted: Array<{ range: unknown; content: unknown }>;
let setAttrs: Array<Record<string, unknown>>;

function render(attrs: Record<string, unknown> = {}) {
  const editor = {
    isEditable: true,
    isDestroyed: false,
    chain: () => {
      const chain = {
        focus: () => chain,
        insertContentAt: (range: unknown, content: unknown) => {
          inserted.push({ range, content });
          return chain;
        },
        run: () => true,
      };
      return chain;
    },
    commands: {
      command: (
        fn: (props: { tr: Record<string, unknown> }) => boolean,
      ): boolean => {
        const tr = {
          doc: { nodeAt: () => ({ attrs: { uploadId: attrs.uploadId } }) },
          setNodeMarkup: (_pos: number, _type: unknown, next: never) => {
            setAttrs.push(next);
            return tr;
          },
          setMeta: () => tr,
        };
        return fn({ tr });
      },
    },
  };
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(VideoBlock, {
          node: {
            attrs: { src: null, uploadId: null, ...attrs },
            type: { name: "video" },
            nodeSize: 1,
          },
          editor,
          selected: true,
          updateAttributes: vi.fn(),
          extension: { options: { documentId: "doc_1" } },
          getPos: () => 4,
        } as never),
      ),
    ),
  );
}

function text() {
  return container.textContent ?? "";
}

async function pick(file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  Object.defineProperty(input!, "files", {
    configurable: true,
    value: [file],
  });
  await act(async () => {
    input!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function focusWindow() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.clipsOn = true;
  state.storage = { state: "free", remaining: 2, limit: 3, maxClipBytes: 9 };
  state.storageError = null;
  state.callAction.mockReset();
  state.uploadVideoFile.mockReset();
  state.beginClipUpload.mockReset();
  inserted = [];
  setAttrs = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
});

describe("the Upload tab while Clips in pages is on", () => {
  it.each([
    [
      { state: "free", remaining: 2, limit: 3, maxClipBytes: 9 },
      'clipEmbed.savedAsClipFree {"count":2}',
    ],
    [
      { state: "free", remaining: 1, limit: 3, maxClipBytes: 9 },
      "clipEmbed.savedAsClipFreeOne",
    ],
    [{ state: "used_up", limit: 3 }, "clipEmbed.savedAsClipFreeNone"],
    [{ state: "ready", provider: "builder" }, "clipEmbed.savedAsClip"],
    [{ state: "none", reason: "disabled" }, "clipEmbed.savedAsClip"],
  ])("says where the video goes for %j", (storage, hint) => {
    state.storage = storage;
    render();
    expect(text()).toContain(hint);
    expect(text()).not.toContain("onboarding.fileStorage");
  });

  it.each([
    ["clips_unreachable", "clipEmbed.unreachable"],
    ["clip_upload_failed", "clipEmbed.uploadStatusFailed"],
  ])(
    "says why when Clips can't say where the video would go: %s",
    (errorCode, message) => {
      state.storageError = Object.assign(new Error("down"), { errorCode });
      render();
      expect(text()).toContain(message);
      expect(text()).not.toContain("clipEmbed.savedAsClip");
    },
  );

  it("refreshes the free clips left once an upload starts", () => {
    render();
    const read = state.queryOptions["get-clip-upload-status"]?.resources;
    expect(read?.length).toBeGreaterThan(0);
    expect(state.mutationOptions["create-clip-upload"]?.resources).toEqual(
      read,
    );
  });

  it("uploads to Clips and swaps the block for the Clip it made", async () => {
    state.callAction.mockResolvedValue(ticket);
    render();
    const file = video();
    await pick(file);

    expect(state.uploadVideoFile).not.toHaveBeenCalled();
    expect(state.callAction).toHaveBeenCalledWith("create-clip-upload", {
      documentId: "doc_1",
      fileName: "demo.mp4",
      sizeBytes: 5,
      mimeType: "video/mp4",
      blockId: expect.stringMatching(/^clip-embed-[A-Za-z0-9]+$/),
    });
    const { blockId } = state.callAction.mock.calls[0][1];
    expect(inserted).toEqual([
      {
        range: { from: 4, to: 5 },
        content: expect.objectContaining({
          attrs: expect.objectContaining({
            blockType: "clip-embed",
            blockId,
            __raw: expect.stringContaining('origin="upload"'),
          }),
        }),
      },
    ]);
    expect(state.beginClipUpload).toHaveBeenCalledWith({
      file,
      ticket,
      documentId: "doc_1",
    });
  });

  it("refuses a video type Clips doesn't take, before asking it", async () => {
    render();
    await pick(video("clip.avi", "video/x-msvideo"));
    expect(state.callAction).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it.each([
    [
      { state: "used_up", limit: 3 },
      "clipEmbed.gateUsedUp",
      ["clipEmbed.connectBuilder", "clipEmbed.customKeys"],
    ],
    [
      { state: "none", reason: "disabled" },
      "clipEmbed.gateNone",
      ["clipEmbed.connectBuilder", "clipEmbed.customKeys"],
    ],
    [
      { state: "account_required" },
      "clipEmbed.gateAccount",
      ["clipEmbed.openClips"],
    ],
  ])(
    "holds the file in the block when Clips has nowhere to save it: %j",
    async (storage, title, links) => {
      state.callAction.mockResolvedValue({
        status: "storage_required",
        storage,
      });
      render();
      await pick(video());

      expect(inserted).toEqual([]);
      expect(state.beginClipUpload).not.toHaveBeenCalled();
      const gate = container.querySelector("[data-clip-upload-gate]");
      expect(gate?.getAttribute("data-clip-upload-gate")).toBe(storage.state);
      expect(text()).toContain(title);
      expect(text()).toContain("demo.mp4");
      expect(text()).toContain("clipEmbed.gateWhyLabel");
      const anchors = Array.from(gate!.querySelectorAll("a"));
      expect(anchors.map((anchor) => anchor.textContent)).toEqual(links);
      for (const anchor of anchors) {
        expect(anchor.target).toBe("_blank");
        expect(anchor.rel).toContain("noopener");
      }
    },
  );

  it("links Connect Builder.io and Custom keys to Clips' own setup", async () => {
    state.callAction.mockResolvedValue({
      status: "storage_required",
      storage: { state: "used_up", limit: 3 },
    });
    render();
    await pick(video());
    expect(
      Array.from(container.querySelectorAll("a")).map((anchor) => anchor.href),
    ).toEqual([
      "https://clips.example.test/record?connectStorage=1",
      "https://clips.example.test/settings/infra#uploads",
    ]);
  });

  it("starts the held file by itself once storage is connected", async () => {
    const file = video();
    state.callAction
      .mockResolvedValueOnce({
        status: "storage_required",
        storage: { state: "used_up", limit: 3 },
      })
      .mockResolvedValueOnce({ storage: { state: "used_up", limit: 3 } })
      .mockResolvedValueOnce({
        storage: { state: "ready", provider: "builder" },
      })
      .mockResolvedValueOnce(ticket);
    render();
    await pick(file);

    // Back from Clips with nothing connected yet: the file keeps waiting.
    await focusWindow();
    expect(state.callAction).toHaveBeenLastCalledWith(
      "get-clip-upload-status",
      { documentId: "doc_1" },
      { method: "GET" },
    );
    expect(container.querySelector("[data-clip-upload-gate]")).not.toBeNull();

    await focusWindow();
    expect(state.callAction).toHaveBeenLastCalledWith(
      "create-clip-upload",
      expect.objectContaining({ fileName: "demo.mp4" }),
    );
    expect(container.querySelector("[data-clip-upload-gate]")).toBeNull();
    expect(inserted).toHaveLength(1);
    expect(state.beginClipUpload).toHaveBeenCalledWith({
      file,
      ticket,
      documentId: "doc_1",
    });
  });

  it("doesn't check while the tab is hidden", async () => {
    state.callAction.mockResolvedValueOnce({
      status: "storage_required",
      storage: { state: "none", reason: "disabled" },
    });
    render();
    await pick(video());
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    await focusWindow();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockRestore();
    expect(state.callAction).toHaveBeenCalledTimes(1);
  });

  it("checks again from the gate's button, and drops the file when asked", async () => {
    state.callAction
      .mockResolvedValueOnce({
        status: "storage_required",
        storage: { state: "none", reason: "disabled" },
      })
      .mockResolvedValueOnce({
        storage: { state: "none", reason: "disabled" },
      });
    render();
    await pick(video());
    const checkAgain = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "clipEmbed.gateCheckAgain",
    );
    await act(async () => checkAgain?.click());
    expect(state.callAction).toHaveBeenLastCalledWith(
      "get-clip-upload-status",
      { documentId: "doc_1" },
      { method: "GET" },
    );

    const discard = container.querySelector<HTMLButtonElement>(
      'button[aria-label="clipEmbed.gateDiscard"]',
    );
    act(() => discard?.click());
    expect(container.querySelector("[data-clip-upload-gate]")).toBeNull();
  });

  it("uploads a video dropped into the page to Clips", async () => {
    state.callAction.mockResolvedValue(ticket);
    const file = video("dropped.webm", "video/webm");
    holdDroppedClipFile("video-upload-1", file);
    await act(async () => render({ uploadId: "video-upload-1" }));

    expect(setAttrs).toEqual([expect.objectContaining({ uploadId: null })]);
    expect(state.callAction).toHaveBeenCalledWith(
      "create-clip-upload",
      expect.objectContaining({
        fileName: "dropped.webm",
        mimeType: "video/webm",
      }),
    );
    expect(state.beginClipUpload).toHaveBeenCalledWith(
      expect.objectContaining({ file }),
    );
  });
});

describe("the Upload tab while Clips in pages is off", () => {
  it("uploads to Content's own file storage, as before", async () => {
    state.clipsOn = false;
    state.uploadVideoFile.mockResolvedValue("https://files.example.test/v.mp4");
    render();
    expect(text()).not.toContain("clipEmbed.savedAsClip");
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.accept).toBe("video/*");

    const file = video("any.mkv", "video/x-matroska");
    await pick(file);
    expect(state.uploadVideoFile).toHaveBeenCalledWith(file);
    expect(state.callAction).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it("leaves a dropped video to Content's own upload", async () => {
    state.clipsOn = false;
    holdDroppedClipFile("video-upload-2", video());
    await act(async () => render({ uploadId: "video-upload-2" }));
    expect(state.callAction).not.toHaveBeenCalled();
    expect(setAttrs).toEqual([]);
  });
});
