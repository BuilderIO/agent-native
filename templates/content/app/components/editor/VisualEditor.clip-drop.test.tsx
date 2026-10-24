// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const state = vi.hoisted(() => ({
  editor: null as Editor | null,
  clipsOn: true,
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      state.editor = editor;
      return editor;
    },
  };
});

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
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

vi.mock("@agent-native/core/client/feature-flags", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/feature-flags")
  >()),
  useFeatureFlag: () => state.clipsOn,
}));

vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: state.toast,
}));

import { VisualEditor } from "./VisualEditor";

function filesEvent(type: "drop" | "paste", files: File[]) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: { files, items: [] } },
    clipboardData: { value: { files } },
    clientX: { value: 0 },
    clientY: { value: 0 },
  });
  return event;
}

function videoNodes(editor: Editor) {
  const found: Array<Record<string, unknown>> = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "video") found.push(node.attrs);
  });
  return found;
}

describe("a video dropped or pasted while uploads go to Clips", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    state.editor = null;
    state.clipsOn = true;
    for (const show of [state.toast, ...Object.values(state.toast)]) {
      if (typeof show === "function" && "mockReset" in show) show.mockReset();
    }
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  async function mount() {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            TooltipProvider,
            null,
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(VisualEditor, {
                content: "Keep local text.",
                documentId: "doc_1",
                onChange: vi.fn(),
              }),
            ),
          ),
        ),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(state.editor).not.toBeNull();
    return state.editor!;
  }

  function handlerFor(editor: Editor, type: "drop" | "paste") {
    const props = editor.options.editorProps;
    return (type === "drop"
      ? props.handleDrop
      : props.handlePaste) as unknown as (
      view: Editor["view"],
      event: Event,
    ) => boolean;
  }

  it.each(["drop", "paste"] as const)(
    "refuses a %s of a type Clips doesn't take, with no empty block",
    async (type) => {
      const editor = await mount();
      const mkv = new File(["video"], "talk.mkv", { type: "video/x-matroska" });
      await act(async () => {
        expect(
          handlerFor(editor, type)(editor.view, filesEvent(type, [mkv])),
        ).toBe(true);
      });

      expect(videoNodes(editor)).toEqual([]);
      expect(state.toast.error).toHaveBeenCalledWith("clipEmbed.uploadType");
    },
  );

  it.each(["drop", "paste"] as const)(
    "takes the videos Clips does take from a mixed %s, and refuses the rest",
    async (type) => {
      const editor = await mount();
      const files = [
        new File(["video"], "demo.mp4", { type: "video/mp4" }),
        new File(["video"], "talk.avi", { type: "video/x-msvideo" }),
      ];
      await act(async () => {
        handlerFor(editor, type)(editor.view, filesEvent(type, files));
      });

      expect(videoNodes(editor)).toHaveLength(1);
      expect(state.toast.error).toHaveBeenCalledWith("clipEmbed.uploadType");
    },
  );

  it("leaves every video to Content's own upload with Clips in pages off", async () => {
    state.clipsOn = false;
    const editor = await mount();
    const mkv = new File(["video"], "talk.mkv", { type: "video/x-matroska" });
    await act(async () => {
      handlerFor(editor, "drop")(editor.view, filesEvent("drop", [mkv]));
    });

    expect(state.toast.error).not.toHaveBeenCalledWith("clipEmbed.uploadType");
  });
});
