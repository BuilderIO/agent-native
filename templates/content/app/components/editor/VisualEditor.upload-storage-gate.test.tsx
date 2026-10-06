// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const captured = vi.hoisted(() => ({ editor: null as Editor | null }));
const uploadStatus = vi.hoisted(() => ({
  current: {
    isSuccess: true,
    isError: false,
    isFetching: false,
    data: undefined as { configured: boolean } | undefined,
    refetch: vi.fn(),
  },
}));
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
  useFileUploadStatus: () => uploadStatus.current,
}));

vi.mock("@agent-native/toolkit/app/chat/FileStorageSetupPopover", async () => {
  const { createElement } = await import("react");
  return {
    FileStorageSetupPopover: ({
      open,
      status,
      onRetry,
    }: {
      open: boolean;
      status?: string;
      onRetry?: () => void;
    }) =>
      open
        ? createElement(
            "div",
            { "data-testid": "file-storage-setup-popover" },
            status === "unavailable"
              ? createElement(
                  "span",
                  {},
                  "onboarding.fileStorage.statusUnavailable",
                )
              : null,
            status === "unavailable"
              ? createElement(
                  "button",
                  { onClick: onRetry, "data-testid": "file-storage-retry" },
                  "common.retry",
                )
              : null,
          )
        : null,
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
    uploadStatus.current = {
      isSuccess: true,
      isError: false,
      isFetching: false,
      data: { configured: false },
      refetch: vi.fn(),
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  async function mount(options: { suggesting?: boolean } = {}) {
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
                suggesting: options.suggesting,
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
    "blocks media %s and opens the shared setup dialog",
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
        document.body.querySelector(
          '[data-testid="file-storage-setup-popover"]',
        ),
      ).not.toBeNull();
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("/_agent-native/file-upload"),
        ),
      ).toBe(false);
    },
  );

  it("resumes the exact dropped File after storage becomes available", async () => {
    const file = new File(["image"], "photo.png", {
      type: "image/png",
      lastModified: 123,
    });
    const editor = await mount();
    const handler = editor.options.editorProps.handleDrop as unknown as (
      view: typeof editor.view,
      event: Event,
    ) => boolean;
    const event = mediaEvent("drop", file);

    await act(async () => {
      expect(handler(editor.view, event)).toBe(true);
    });
    expect(
      document.body.querySelector('[data-testid="file-storage-setup-popover"]'),
    ).not.toBeNull();

    uploadStatus.current = {
      isSuccess: true,
      isError: false,
      isFetching: false,
      data: { configured: true },
      refetch: vi.fn(),
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ url: "https://files.example/photo.png" })),
    );
    await mount();

    const uploadCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/_agent-native/file-upload"),
    );
    expect(uploadCall).toBeDefined();
    const form = (uploadCall?.[1] as RequestInit).body as FormData;
    const uploadedFile = form.get("file") as File;
    expect(uploadedFile).toMatchObject({
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
    });
    expect(await uploadedFile.text()).toBe(await file.text());
  });

  it("does not upload queued media if the editor enters suggesting mode", async () => {
    const editor = await mount();
    const file = new File(["image"], "photo.png", { type: "image/png" });
    const handler = editor.options.editorProps.handleDrop as unknown as (
      view: typeof editor.view,
      event: Event,
    ) => boolean;
    const event = mediaEvent("drop", file);

    await act(async () => {
      expect(handler(editor.view, event)).toBe(true);
    });

    uploadStatus.current = {
      isSuccess: true,
      isError: false,
      isFetching: false,
      data: { configured: true },
      refetch: vi.fn(),
    };
    await mount({ suggesting: true });

    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/_agent-native/file-upload"),
      ),
    ).toBe(false);
  });

  it.each([
    ["loading", "drop", false],
    ["unavailable", "paste", true],
  ] as const)(
    "shows retry instead of setup when storage status is %s",
    async (_state, type, isError) => {
      const refetch = vi.fn();
      uploadStatus.current = {
        isSuccess: false,
        isError,
        isFetching: !isError,
        data: undefined,
        refetch,
      };
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
        document.body.querySelector(
          '[data-testid="file-storage-setup-popover"]',
        ),
      ).not.toBeNull();
      expect(document.body.textContent).toContain(
        "onboarding.fileStorage.statusUnavailable",
      );
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("/_agent-native/file-upload"),
        ),
      ).toBe(false);
      await act(async () => {
        document.body
          .querySelector<HTMLButtonElement>(
            '[data-testid="file-storage-retry"]',
          )
          ?.click();
      });
      expect(refetch).toHaveBeenCalledOnce();
    },
  );

  it("keeps configured storage out of the setup gate", async () => {
    uploadStatus.current = {
      isSuccess: true,
      isError: false,
      isFetching: false,
      data: { configured: true },
      refetch: vi.fn(),
    };

    await mount();

    expect(
      document.body.querySelector('[data-testid="file-storage-setup-popover"]'),
    ).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
    ).toBe(false);
  });

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
      document.body.querySelector('[data-testid="file-storage-setup-popover"]'),
    ).toBeNull();
  });
});
