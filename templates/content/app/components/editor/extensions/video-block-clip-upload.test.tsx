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
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: state.toast }));

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
  cancelUrl:
    "https://clips.example.test/api/uploads/rec_1/content-cancel?ticket=t",
  chunkSizeBytes: 3,
  totalChunks: 2,
  expiresAt: "2026-10-24T12:00:00.000Z",
};

function video(name = "demo.mp4", type = "video/mp4") {
  return new File([new Uint8Array([1, 2, 3, 4, 5])], name, { type });
}

let root: Root;
let container: HTMLDivElement;

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}
let inserted: Array<{ range: unknown; content: unknown }>;
let setAttrs: Array<Record<string, unknown>>;
let deleted: unknown[];
let swapSucceeds: boolean;

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
        command: (fn: (props: { tr: { setMeta: () => void } }) => boolean) => {
          fn({ tr: { setMeta: () => undefined } });
          return chain;
        },
        deleteRange: (range: unknown) => {
          deleted.push(range);
          return chain;
        },
        run: () => swapSucceeds,
      };
      return chain;
    },
    state: {
      doc: {
        nodeAt: () => ({
          type: { name: "video" },
          attrs: { src: null },
          nodeSize: 1,
        }),
      },
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
  return editor;
}

function text() {
  return container.textContent;
}

async function pick(file: File) {
  const input = defined(
    container.querySelector<HTMLInputElement>('input[type="file"]'),
  );
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function focusWindow() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
}

async function clickCheckAgain() {
  const button = defined(
    Array.from(container.querySelectorAll("button")).find(
      (each) => each.textContent === "clipEmbed.gateCheckAgain",
    ),
  );
  await act(async () => button.click());
}

async function clickTryAgain() {
  const button = defined(
    Array.from(container.querySelectorAll("button")).find(
      (each) => each.textContent === "clipEmbed.retry",
    ),
  );
  await act(async () => button.click());
}

function clickRemove() {
  const button = defined(
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="clipEmbed.gateDiscard"]',
    ),
  );
  act(() => button.click());
}

/** What each start of an upload sent. */
function starts(): Array<Record<string, unknown>> {
  return state.callAction.mock.calls
    .filter(([name]) => name === "create-clip-upload")
    .map(([, variables]) => variables);
}

/** An answer the test gives when it chooses. */
function later() {
  let answer: (value: unknown) => void = () => {};
  const promise = new Promise((resolve) => {
    answer = resolve;
  });
  return { promise, answer: (value: unknown) => answer(value) };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.clipsOn = true;
  state.storage = { state: "free", remaining: 2, limit: 3, maxClipBytes: 9 };
  state.storageError = null;
  state.callAction.mockReset();
  state.uploadVideoFile.mockReset();
  state.beginClipUpload.mockReset();
  for (const show of Object.values(state.toast)) show.mockReset();
  inserted = [];
  setAttrs = [];
  deleted = [];
  swapSucceeds = true;
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
    [{ state: "ready", provider: "builder" }, "clipEmbed.savedAsClip"],
  ])("says where the video goes for %j", (storage, hint) => {
    state.storage = storage;
    render();
    expect(text()).toContain(hint);
    expect(text()).not.toContain("onboarding.fileStorage");
  });

  it.each([
    ["no storage", { state: "none", reason: "disabled" }],
    ["no Clips account", { state: "account_required" }],
    ["the free clips used up", { state: "used_up", limit: 3 }],
    ["storage not known yet", undefined],
  ])("says nothing will be saved as a Clip with %s", (_with, storage) => {
    state.storage = storage;
    render();
    expect(text()).not.toContain("clipEmbed.savedAsClip");
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
      uploadKey: expect.stringMatching(/^[A-Za-z0-9_-]{16,64}$/),
    });
    const { blockId } = defined(state.callAction.mock.calls[0])[1];
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
      blockId,
    });
  });

  it("cancels the upload in Clips, and says so, when its block is gone before the Clip", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ outcome: "cancelled", recordingId: "rec_1" }),
    );
    vi.stubGlobal("fetch", fetch);
    state.callAction.mockResolvedValue(ticket);
    swapSucceeds = false;
    render();
    await pick(video());

    expect(state.beginClipUpload).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      ticket.cancelUrl,
      expect.objectContaining({ method: "POST", credentials: "omit" }),
    );
    await vi.waitFor(() =>
      expect(state.toast.error).toHaveBeenCalledWith(
        "clipEmbed.uploadCancelledBlockGone",
      ),
    );
  });

  it("says the video was already saved as a Clip when Clips finished it before the cancel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "This upload is already finished",
            outcome: "already_finished",
            recordingId: "rec_1",
            status: "processing",
          },
          { status: 409 },
        ),
      ),
    );
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    state.callAction.mockImplementation(async (name: string) =>
      name === "get-clips-links"
        ? { appUrl: "https://clips.example.test", linkOrigins: [] }
        : ticket,
    );
    swapSucceeds = false;
    render();
    await pick(video());

    await vi.waitFor(() =>
      expect(state.toast.info).toHaveBeenCalledWith(
        "clipEmbed.uploadAlreadySaved",
        {
          action: {
            label: "clipEmbed.openInClips",
            onClick: expect.any(Function),
          },
        },
      ),
    );
    expect(state.toast.error).not.toHaveBeenCalled();
    defined(state.toast.info.mock.calls[0])[1].action.onClick();
    expect(open).toHaveBeenCalledWith(
      "https://clips.example.test/r/rec_1",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });

  it("says Clips didn't confirm the cancel, not that it was cancelled, when Clips doesn't answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );
    state.callAction.mockResolvedValue(ticket);
    swapSucceeds = false;
    render();
    await pick(video());

    await vi.waitFor(() =>
      expect(state.toast.error).toHaveBeenCalledWith(
        "clipEmbed.uploadCancelUnconfirmed",
      ),
    );
    expect(state.toast.error).not.toHaveBeenCalledWith(
      "clipEmbed.uploadCancelledBlockGone",
    );
  });

  it("cancels the upload, and says why, when edit access went while Clips started it", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ outcome: "cancelled", recordingId: "rec_1" }),
    );
    vi.stubGlobal("fetch", fetch);
    const editor = render();
    state.callAction.mockImplementation(async () => {
      editor.isEditable = false;
      return ticket;
    });
    await pick(video());

    expect(inserted).toEqual([]);
    expect(state.beginClipUpload).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      ticket.cancelUrl,
      expect.objectContaining({ method: "POST" }),
    );
    await vi.waitFor(() =>
      expect(state.toast.error).toHaveBeenCalledWith(
        "clipEmbed.uploadCancelledReadOnly",
      ),
    );
  });

  it("refuses a video type Clips doesn't take, before asking it", async () => {
    render();
    await pick(video("clip.avi", "video/x-msvideo"));
    expect(state.callAction).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it("refuses an empty file, before asking Clips", async () => {
    render();
    await pick(new File([], "empty.mp4", { type: "video/mp4" }));
    expect(state.callAction).not.toHaveBeenCalled();
    expect(state.toast.error).toHaveBeenCalledWith("clipEmbed.uploadFailed");
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
      const anchors = Array.from(defined(gate).querySelectorAll("a"));
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
      blockId: expect.stringMatching(/^clip-embed-/),
    });
  });

  it("sends one upload key and block for a picked file, however many times it starts", async () => {
    state.callAction
      .mockResolvedValueOnce({
        status: "storage_required",
        storage: { state: "none", reason: "disabled" },
      })
      .mockResolvedValueOnce({
        storage: { state: "ready", provider: "builder" },
      })
      .mockResolvedValueOnce(ticket)
      .mockResolvedValueOnce(ticket);
    render();
    await pick(video());
    await clickCheckAgain();
    await pick(video("another.mp4"));

    const starts = state.callAction.mock.calls
      .filter(([name]) => name === "create-clip-upload")
      .map(([, variables]) => variables);
    expect(starts).toHaveLength(3);
    expect(starts[1]).toMatchObject({
      uploadKey: starts[0].uploadKey,
      blockId: starts[0].blockId,
    });
    expect(starts[2].uploadKey).not.toBe(starts[0].uploadKey);
    expect(starts[2].blockId).not.toBe(starts[0].blockId);
  });

  it("asks again, with the same key, while Clips is still making the first start's Clip", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      state.callAction
        .mockResolvedValueOnce({
          status: "storage_required",
          storage: { state: "none", reason: "disabled" },
        })
        .mockResolvedValueOnce({
          storage: { state: "ready", provider: "builder" },
        })
        .mockResolvedValueOnce({ status: "starting" })
        .mockResolvedValueOnce({ status: "starting" })
        .mockResolvedValueOnce(ticket);
      render();
      await pick(video());
      await clickCheckAgain();
      expect(starts()).toHaveLength(2);

      await act(() => vi.advanceTimersByTimeAsync(2_000));
      expect(starts()).toHaveLength(3);
      await act(() => vi.advanceTimersByTimeAsync(5_000));

      expect(starts()).toHaveLength(4);
      expect(new Set(starts().map((each) => each.uploadKey)).size).toBe(1);
      expect(new Set(starts().map((each) => each.blockId)).size).toBe(1);
      expect(state.beginClipUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket,
          blockId: defined(starts()[0]).blockId,
        }),
      );
      expect(state.toast.error).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the file with its key when Clips is still making the first start's Clip after every retry, and starts it with that key from the gate", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      state.callAction
        .mockResolvedValueOnce({ status: "starting" })
        .mockResolvedValueOnce({ status: "starting" })
        .mockResolvedValueOnce({ status: "starting" })
        .mockResolvedValueOnce({ status: "starting" })
        .mockResolvedValueOnce(ticket);
      render();
      await pick(video());
      await act(() => vi.advanceTimersByTimeAsync(2_000 + 5_000 + 10_000));

      expect(starts()).toHaveLength(4);
      const gate = container.querySelector("[data-clip-upload-gate]");
      expect(gate?.getAttribute("data-clip-upload-gate")).toBe("unanswered");
      expect(gate?.textContent).toContain("clipEmbed.uploadFailed");
      expect(state.toast.error).not.toHaveBeenCalled();
      expect(state.beginClipUpload).not.toHaveBeenCalled();
      expect(inserted).toEqual([]);

      await clickTryAgain();
      expect(starts()).toHaveLength(5);
      expect(new Set(starts().map((each) => each.uploadKey)).size).toBe(1);
      expect(state.beginClipUpload).toHaveBeenCalledWith(
        expect.objectContaining({ ticket }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the file under a new key, trying nothing again, once Clips says its key's upload ended", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      state.callAction
        .mockResolvedValueOnce({ status: "key_used" })
        .mockResolvedValueOnce(ticket);
      render();
      await pick(video());
      await act(() => vi.advanceTimersByTimeAsync(2_000 + 5_000 + 10_000));

      expect(starts()).toHaveLength(1);
      const gate = container.querySelector("[data-clip-upload-gate]");
      expect(gate?.getAttribute("data-clip-upload-gate")).toBe("unanswered");
      expect(gate?.textContent).toContain("clipEmbed.uploadFailed");
      expect(state.toast.error).not.toHaveBeenCalled();

      await clickTryAgain();
      expect(starts()).toHaveLength(2);
      expect(defined(starts()[1]).uploadKey).not.toBe(
        defined(starts()[0]).uploadKey,
      );
      expect(state.beginClipUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket,
          blockId: defined(starts()[1]).blockId,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the file with its key, trying nothing again, while Clips has too many uploads in progress", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      state.callAction
        .mockRejectedValueOnce(
          Object.assign(new Error("Too many uploads"), {
            errorCode: "clip_rate_limited",
          }),
        )
        .mockResolvedValueOnce(ticket);
      render();
      await pick(video());
      await act(() => vi.advanceTimersByTimeAsync(2_000 + 5_000 + 10_000));

      expect(starts()).toHaveLength(1);
      const gate = container.querySelector("[data-clip-upload-gate]");
      expect(gate?.getAttribute("data-clip-upload-gate")).toBe("unanswered");
      expect(gate?.textContent).toContain("clipEmbed.rateLimited");
      expect(state.toast.error).not.toHaveBeenCalled();

      await clickTryAgain();
      expect(starts()).toHaveLength(2);
      expect(new Set(starts().map((each) => each.uploadKey)).size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts again with the same key when Clips' answer can't be read", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      state.callAction
        .mockRejectedValueOnce(
          Object.assign(new Error("Clips' answer couldn't be read"), {
            errorCode: "clip_upload_failed",
          }),
        )
        .mockResolvedValueOnce(ticket);
      render();
      await pick(video());
      await act(() => vi.advanceTimersByTimeAsync(2_000));

      expect(starts()).toHaveLength(2);
      expect(new Set(starts().map((each) => each.uploadKey)).size).toBe(1);
      expect(state.beginClipUpload).toHaveBeenCalledWith(
        expect.objectContaining({ ticket }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  const noAnswer = () =>
    Object.assign(new Error("Clips didn't answer"), {
      errorCode: "clips_unreachable",
    });

  it("starts again with the same key when a start gets no answer, so Clips makes one recording", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      state.callAction
        .mockRejectedValueOnce(noAnswer())
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(ticket);
      render();
      await pick(video());
      expect(starts()).toHaveLength(1);

      await act(() => vi.advanceTimersByTimeAsync(2_000));
      expect(starts()).toHaveLength(2);
      await act(() => vi.advanceTimersByTimeAsync(5_000));

      expect(starts()).toHaveLength(3);
      expect(new Set(starts().map((each) => each.uploadKey)).size).toBe(1);
      expect(new Set(starts().map((each) => each.blockId)).size).toBe(1);
      expect(state.beginClipUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket,
          blockId: defined(starts()[0]).blockId,
        }),
      );
      expect(state.toast.error).not.toHaveBeenCalled();
      expect(container.querySelector("[data-clip-upload-gate]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the file once every start gets no answer, and starts it with the same key from the gate", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      state.callAction
        .mockRejectedValueOnce(noAnswer())
        .mockRejectedValueOnce(noAnswer())
        .mockRejectedValueOnce(noAnswer())
        .mockRejectedValueOnce(noAnswer())
        .mockResolvedValueOnce(ticket);
      render();
      await pick(video());
      await act(() => vi.advanceTimersByTimeAsync(2_000 + 5_000 + 10_000));

      expect(starts()).toHaveLength(4);
      const gate = container.querySelector("[data-clip-upload-gate]");
      expect(gate?.getAttribute("data-clip-upload-gate")).toBe("unanswered");
      expect(gate?.textContent).toContain("clipEmbed.unreachable");
      expect(gate?.textContent).toContain("demo.mp4");
      expect(gate?.querySelectorAll("a")).toHaveLength(0);
      expect(state.beginClipUpload).not.toHaveBeenCalled();
      expect(state.toast.error).not.toHaveBeenCalled();

      await clickTryAgain();
      expect(starts()).toHaveLength(5);
      expect(new Set(starts().map((each) => each.uploadKey)).size).toBe(1);
      expect(state.beginClipUpload).toHaveBeenCalledWith(
        expect.objectContaining({ ticket }),
      );
      expect(container.querySelector("[data-clip-upload-gate]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the file and its key when it is removed after its starts got no answer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      state.callAction.mockRejectedValue(noAnswer());
      render();
      await pick(video());
      await act(() => vi.advanceTimersByTimeAsync(2_000 + 5_000 + 10_000));
      const firstKey = defined(starts()[0]).uploadKey;
      clickRemove();
      expect(container.querySelector("[data-clip-upload-gate]")).toBeNull();

      state.callAction.mockReset();
      state.callAction.mockResolvedValueOnce(ticket);
      await pick(video());
      expect(starts()).toHaveLength(1);
      expect(defined(starts()[0]).uploadKey).not.toBe(firstKey);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts nothing again after Clips refuses a start, and holds nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      state.callAction.mockRejectedValueOnce(
        Object.assign(new Error("Edit access required"), {
          errorCode: "document_edit_required",
        }),
      );
      render();
      await pick(video());
      await act(() => vi.advanceTimersByTimeAsync(2_000 + 5_000 + 10_000));

      expect(starts()).toHaveLength(1);
      expect(state.toast.error).toHaveBeenCalledWith(
        "clipEmbed.uploadEditRequired",
      );
      expect(container.querySelector("[data-clip-upload-gate]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts nothing again after Content itself refuses a start, and holds nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      state.callAction.mockRejectedValueOnce(
        Object.assign(
          new Error("Action create-clip-upload failed: Invalid input"),
          { status: 400 },
        ),
      );
      render();
      await pick(video());
      await act(() => vi.advanceTimersByTimeAsync(2_000 + 5_000 + 10_000));

      expect(starts()).toHaveLength(1);
      expect(state.toast.error).toHaveBeenCalledWith("clipEmbed.uploadFailed");
      expect(container.querySelector("[data-clip-upload-gate]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [
      "never reaches Content",
      () => new Error("Action create-clip-upload failed: Failed to fetch"),
    ],
    [
      "times out",
      () =>
        Object.assign(
          new Error("Action create-clip-upload timed out after 30s"),
          { status: 408, timedOut: true },
        ),
    ],
    [
      "fails in Content's server",
      () =>
        Object.assign(
          new Error("Action create-clip-upload failed: Bad Gateway"),
          { status: 502 },
        ),
    ],
  ])(
    "starts again with the same key when a start %s",
    async (_how, failure) => {
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      try {
        state.callAction
          .mockRejectedValueOnce(failure())
          .mockResolvedValueOnce(ticket);
        render();
        await pick(video());
        await act(() => vi.advanceTimersByTimeAsync(2_000));

        expect(starts()).toHaveLength(2);
        expect(new Set(starts().map((each) => each.uploadKey)).size).toBe(1);
        expect(state.beginClipUpload).toHaveBeenCalledWith(
          expect.objectContaining({ ticket }),
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("places the Clip, uploading nothing, when Clips already has the whole file from this pick", async () => {
    state.callAction.mockResolvedValue({
      status: "already_finished",
      recordingId: "rec_1",
    });
    render();
    await pick(video());

    const { blockId } = defined(state.callAction.mock.calls[0])[1];
    expect(inserted).toEqual([
      {
        range: { from: 4, to: 5 },
        content: expect.objectContaining({
          attrs: expect.objectContaining({
            blockId,
            __raw: expect.stringContaining('recordingId="rec_1"'),
          }),
        }),
      },
    ]);
    expect(state.beginClipUpload).not.toHaveBeenCalled();
    expect(state.toast.error).not.toHaveBeenCalled();
  });

  it("says the video is already a Clip, cancelling nothing, when that Clip's block can't go in", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    swapSucceeds = false;
    state.callAction.mockImplementation(async (name: string) =>
      name === "get-clips-links"
        ? { appUrl: "https://clips.example.test" }
        : { status: "already_finished", recordingId: "rec_1" },
    );
    render();
    await pick(video());

    await vi.waitFor(() =>
      expect(state.toast.info).toHaveBeenCalledWith(
        "clipEmbed.uploadAlreadySaved",
        expect.anything(),
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(state.toast.error).not.toHaveBeenCalled();
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

  it.each([
    ["the gate's button", clickCheckAgain],
    ["coming back to the tab", focusWindow],
  ])(
    "uploads nothing once the file is removed during a check from %s",
    async (_from, check) => {
      const status = later();
      state.callAction
        .mockResolvedValueOnce({
          status: "storage_required",
          storage: { state: "none", reason: "disabled" },
        })
        .mockImplementationOnce(() => status.promise);
      render();
      await pick(video());
      await check();
      clickRemove();
      await act(async () =>
        status.answer({ storage: { state: "ready", provider: "builder" } }),
      );

      expect(state.callAction.mock.calls.map(([name]) => name)).toEqual([
        "create-clip-upload",
        "get-clip-upload-status",
      ]);
      expect(state.beginClipUpload).not.toHaveBeenCalled();
      expect(inserted).toEqual([]);
      expect(container.querySelector("[data-clip-upload-gate]")).toBeNull();
    },
  );

  it("doesn't bring a removed file back when a check finds nowhere to save it", async () => {
    const status = later();
    state.callAction
      .mockResolvedValueOnce({
        status: "storage_required",
        storage: { state: "none", reason: "disabled" },
      })
      .mockImplementationOnce(() => status.promise);
    render();
    await pick(video());
    await clickCheckAgain();
    clickRemove();
    await act(async () =>
      status.answer({ storage: { state: "used_up", limit: 3 } }),
    );
    expect(container.querySelector("[data-clip-upload-gate]")).toBeNull();
  });

  it("gives the upload back to Clips when the file is removed while Clips starts it", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ outcome: "cancelled", recordingId: "rec_1" }),
    );
    vi.stubGlobal("fetch", fetch);
    const started = later();
    state.callAction
      .mockResolvedValueOnce({
        status: "storage_required",
        storage: { state: "none", reason: "disabled" },
      })
      .mockResolvedValueOnce({
        storage: { state: "ready", provider: "builder" },
      })
      .mockImplementationOnce(() => started.promise);
    render();
    await pick(video());
    await clickCheckAgain();
    clickRemove();
    await act(async () => started.answer(ticket));

    expect(inserted).toEqual([]);
    expect(state.beginClipUpload).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      ticket.cancelUrl,
      expect.objectContaining({ method: "POST", credentials: "omit" }),
    );
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
    expect(deleted).toEqual([]);
  });

  it("removes the block made for a dropped video Clips refuses as too large", async () => {
    state.callAction.mockResolvedValue({
      status: "too_large",
      maxBytes: 2_000_000,
    });
    holdDroppedClipFile("video-upload-3", video("huge.mp4"));
    await act(async () => render({ uploadId: "video-upload-3" }));

    expect(state.toast.error).toHaveBeenCalledWith(
      expect.stringContaining("clipEmbed.uploadTooLarge"),
    );
    expect(deleted).toEqual([{ from: 4, to: 5 }]);
  });

  it("removes the block made for an empty dropped video without asking Clips", async () => {
    holdDroppedClipFile(
      "video-upload-4",
      new File([], "empty.mp4", { type: "video/mp4" }),
    );
    await act(async () => render({ uploadId: "video-upload-4" }));

    expect(state.callAction).not.toHaveBeenCalled();
    expect(deleted).toEqual([{ from: 4, to: 5 }]);
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
