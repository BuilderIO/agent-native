// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const captured = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      captured.editor = editor;
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
    data: { configured: false },
  }),
}));

vi.mock("@agent-native/core/client/setup-connections", async () => {
  const { createElement } = await import("react");
  return {
    FileStorageSetupCard: () =>
      createElement("div", { "data-testid": "file-storage-setup-card" }),
  };
});

import { VisualEditor } from "./VisualEditor";

function mediaEvent(type: "drop" | "paste", file: File) {
  const event = new Event(type, { cancelable: true }) as Event & {
    dataTransfer?: { files: File[]; items: [] };
    clipboardData?: { files: File[] };
    clientX: number;
    clientY: number;
  };
  Object.defineProperties(event, {
    dataTransfer: { value: { files: [file], items: [] } },
    clipboardData: { value: { files: [file] } },
    clientX: { value: 0 },
    clientY: { value: 0 },
  });
  return event;
}

describe("VisualEditor upload storage gate", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    captured.editor = null;
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
    expect(captured.editor).not.toBeNull();
    return captured.editor!;
  }

  it.each(["drop", "paste"] as const)(
    "blocks media %s and opens the shared setup card",
    async (type) => {
      const editor = await mount();
      const file = new File(["image"], "photo.png", { type: "image/png" });
      const handler = (
        editor.options.editorProps as unknown as Record<
          string,
          (view: typeof editor.view, event: Event) => boolean
        >
      )[type === "drop" ? "handleDrop" : "handlePaste"];
      const event = mediaEvent(type, file);

      await act(async () => {
        expect(handler(editor.view, event)).toBe(true);
      });

      expect(event.defaultPrevented).toBe(true);
      expect(
        editor.getJSON().content?.some((node) => node.type === "image"),
      ).toBe(false);
      expect(
        document.body.querySelector('[data-testid="file-storage-setup-card"]'),
      ).not.toBeNull();
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("/_agent-native/file-upload"),
        ),
      ).toBe(false);
    },
  );

  it("leaves a local CSV drop outside the storage gate", async () => {
    const editor = await mount();
    const file = new File(["name\nAda"], "people.csv", { type: "text/csv" });
    const handler = editor.options.editorProps.handleDrop as unknown as (
      view: typeof editor.view,
      event: Event,
    ) => boolean;
    const event = mediaEvent("drop", file);

    await act(async () => {
      expect(handler(editor.view, event)).toBe(false);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(
      document.body.querySelector('[data-testid="file-storage-setup-card"]'),
    ).toBeNull();
  });
});
