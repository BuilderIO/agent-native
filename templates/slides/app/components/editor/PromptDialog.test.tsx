// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render as renderWithoutQueryClient,
  screen,
  waitFor,
  type RenderOptions,
} from "@testing-library/react";
import {
  createRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type ReactNode,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SLIDE_FILE_STORAGE_STATUS_KEY } from "@/hooks/use-slide-file-storage-status";

function render(ui: ReactNode, options?: RenderOptions) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(SLIDE_FILE_STORAGE_STATUS_KEY, { configured: true });
  return renderWithoutQueryClient(ui, {
    ...options,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

const ensureEmbedAuthFetchInterceptor = vi.hoisted(() => vi.fn());
const promptComposerProps = vi.hoisted(() => vi.fn());
const promptFile = new File(["pdf"], "large.pdf", {
  type: "application/pdf",
});

function stubReadyStorageUpload(
  uploadFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
) {
  vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
    const input = args[0];
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes("/api/uploads/status")) {
      return new Response(JSON.stringify({ referenceStorageReady: true }), {
        status: 200,
      });
    }
    return uploadFetch(...args);
  });
}

function useEagerFileUploadsMock<T>(
  upload: (files: File[]) => Promise<readonly T[]>,
) {
  const uploadsRef = useRef(new Map<File, Promise<T>>());
  const [uploading, setUploading] = useState(false);
  const uploadFiles = useCallback(
    async (files: readonly File[]) => {
      const newFiles = [...new Set(files)].filter(
        (file) => !uploadsRef.current.has(file),
      );
      if (newFiles.length > 0) {
        const batch = upload(newFiles);
        newFiles.forEach((file, index) => {
          uploadsRef.current.set(
            file,
            batch.then((results) => results[index]!),
          );
        });
        setUploading(true);
        void batch.then(
          () => setUploading(false),
          () => setUploading(false),
        );
      }
      return Promise.all(files.map((file) => uploadsRef.current.get(file)!));
    },
    [upload],
  );
  const reset = useCallback(() => {
    uploadsRef.current.clear();
    setUploading(false);
  }, []);
  return {
    commitFiles: () => {},
    discardFiles: () => {},
    retainFiles: () => {},
    syncFiles: () => {},
    uploadFiles,
    uploading,
    reset,
  };
}

vi.mock("@agent-native/core/client/composer", () => ({
  PromptComposer: (props: {
    disabled?: boolean;
    submissionDisabled?: boolean;
    showModelSelector?: boolean;
    modelStatusChecksEnabled?: boolean;
    initialText?: string;
    initialTextKey?: string | number;
    composerRef?: Ref<{
      focus(): void;
      submitWithText(text: string): Promise<boolean>;
    }>;
    onTextChange?: (text: string) => void;
    contextItems?: readonly unknown[];
    onAttachmentsChange?: (files: File[]) => void;
    attachmentAdapter?: { accept: string };
    onModelSelectionChange?: (selection: {
      model?: string;
      engine?: string;
      effort?: string;
    }) => void;
    onSubmit: (
      text: string,
      files: File[],
      references: unknown[],
      options: Record<string, unknown>,
    ) => void | Promise<void>;
  }) => {
    promptComposerProps(props);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(props.composerRef, () => ({
      focus: () => inputRef.current?.focus(),
      submitWithText: async (text: string) => {
        if (props.disabled || props.submissionDisabled) return false;
        try {
          await props.onSubmit(text, [promptFile], [], {
            model: "gpt-5.6-terra",
            engine: "builder",
            effort: "high",
            contextItems: props.contextItems,
            attachments: [
              {
                name: promptFile.name,
                contentType: promptFile.type,
                file: promptFile,
              },
            ],
          });
          return true;
        } catch {
          return false;
        }
      },
    }));
    useEffect(() => {
      props.onModelSelectionChange?.({
        model: "gpt-5.6-terra",
        engine: "builder",
        effort: "high",
      });
    }, [props.onModelSelectionChange]);
    return (
      <>
        <textarea
          ref={inputRef}
          aria-label="Prompt"
          value={props.initialText ?? ""}
          readOnly
          onChange={(event) => props.onTextChange?.(event.target.value)}
        />
        <button
          type="button"
          data-testid="prompt-composer-attach"
          disabled={props.disabled}
          onClick={() => props.onAttachmentsChange?.([promptFile])}
        >
          Attach
        </button>
        <button
          type="button"
          data-testid="prompt-composer"
          disabled={props.disabled || props.submissionDisabled}
          onClick={() =>
            void props.onSubmit("  make a deck  \n", [promptFile], [], {
              model: "gpt-5.6-terra",
              engine: "builder",
              effort: "high",
            })
          }
        >
          Prompt composer
        </button>
      </>
    );
  },
  useEagerFileUploads: useEagerFileUploadsMock,
}));

vi.mock("@agent-native/core/client/host", () => ({
  ensureEmbedAuthFetchInterceptor,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "editorToolbar.importFile": "Import file",
      "home.googleSlidesImportLabel": "Slides",
      "home.googleSlidesReferenceTitle": "Google Slides",
      "home.googleSlidesReferenceUrl": "Paste a Google Slides link",
      "raw.uploadFailed": "Upload failed",
      "raw.uploadAttachedFailed": "Upload failed",
      "raw.uploading": "Uploading...",
    })[key] ?? key,
}));

vi.mock("./GoogleDocImportHint", () => ({
  GoogleDocImportHint: () => null,
}));

vi.mock("./GoogleDriveConnectionCta", () => ({
  GoogleDriveConnectionCta: () => (
    <div data-testid="google-drive-connection-cta" />
  ),
}));

import { isInsidePortaledLayer } from "@/lib/portaled-layer";
import {
  addInlineImageFallbacks,
  isPromptUploadAuthRequiredError,
  isPromptUploadNetworkError,
  isPromptUploadStorageStatusError,
  isReferenceStorageReady,
  uploadPromptFiles as uploadPromptFilesImpl,
} from "@/lib/prompt-file-uploads";

import { SLIDES_REFERENCE_FILE_ACCEPT } from "../../../shared/upload-types";
import PromptPopover, {
  createPromptChatAttachments,
  type PromptPopoverHandle,
} from "./PromptDialog";
import type { useSlidesComposerContext } from "./SlidesComposerContext";

const uploadPromptFiles = (files: File[]) =>
  uploadPromptFilesImpl(files, "File storage is unavailable.");

describe("createPromptChatAttachments", () => {
  it("keeps PDFs and pasted text as display-only chat descriptors", async () => {
    const result = await createPromptChatAttachments(
      [
        {
          name: "reference.pdf",
          contentType: "application/pdf",
          file: new File(["pdf bytes"], "reference.pdf", {
            type: "application/pdf",
          }),
        },
        {
          name: "pasted-text-1.txt",
          contentType: "text/plain",
          file: new File(["outline"], "pasted-text-1.txt", {
            type: "text/plain",
          }),
        },
      ],
      [
        {
          path: "uploads/reference.pdf",
          originalName: "reference.pdf",
          filename: "reference.pdf",
          type: "application/pdf",
          size: 9,
        },
      ],
    );

    expect(result).toEqual([
      {
        type: "file",
        name: "reference.pdf",
        contentType: "application/pdf",
        displayOnly: true,
      },
      {
        type: "file",
        name: "pasted-text-1.txt",
        contentType: "text/plain",
        displayOnly: true,
        text: "outline",
      },
    ]);
  });

  it("can prepare attachment descriptors before uploads start", async () => {
    await expect(
      createPromptChatAttachments(
        [
          {
            name: "reference.pdf",
            contentType: "application/pdf",
          },
          {
            name: "pasted-text-1.txt",
            contentType: "text/plain",
            file: new File(["outline"], "pasted-text-1.txt", {
              type: "text/plain",
            }),
          },
        ],
        [],
      ),
    ).resolves.toEqual([
      {
        type: "file",
        name: "reference.pdf",
        contentType: "application/pdf",
        displayOnly: true,
      },
      {
        type: "file",
        name: "pasted-text-1.txt",
        contentType: "text/plain",
        displayOnly: true,
        text: "outline",
      },
    ]);
  });

  it("does not add a duplicate file descriptor for uploaded images", async () => {
    await expect(
      createPromptChatAttachments(
        [
          {
            name: "team.png",
            contentType: "image/png",
            file: new File(["image"], "team.png", { type: "image/png" }),
          },
        ],
        [
          {
            path: "uploads/team.png",
            url: "https://cdn.example.test/team.png",
            originalName: "team.png",
            filename: "team.png",
            type: "image/png",
            size: 5,
          },
        ],
      ),
    ).resolves.toEqual([]);
  });
});

describe("addInlineImageFallbacks", () => {
  it("uses inline bytes only when the provider did not return a URL", async () => {
    const file = new File(["image"], "team.png", { type: "image/png" });
    const uploaded = {
      path: "uploads/team.png",
      url: "https://cdn.example.test/team.png",
      dataUrl: "data:image/png;base64,aW1hZ2U=",
      originalName: "team.png",
      filename: "team.png",
      type: "image/png",
      size: 5,
    };

    await expect(addInlineImageFallbacks([file], [uploaded])).resolves.toEqual([
      {
        path: "uploads/team.png",
        url: "https://cdn.example.test/team.png",
        originalName: "team.png",
        filename: "team.png",
        type: "image/png",
        size: 5,
      },
    ]);
  });
});

describe("isInsidePortaledLayer", () => {
  it("matches nodes inside a Radix popper layer", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-radix-popper-content-wrapper", "");
    const button = document.createElement("button");
    wrapper.append(button);
    document.body.append(wrapper);

    expect(isInsidePortaledLayer(button)).toBe(true);
    wrapper.remove();
  });

  it("ignores ordinary nodes and non-elements", () => {
    const button = document.createElement("button");
    document.body.append(button);

    expect(isInsidePortaledLayer(button)).toBe(false);
    expect(isInsidePortaledLayer(document.createTextNode("x"))).toBe(false);
    expect(isInsidePortaledLayer(null)).toBe(false);
    button.remove();
  });
});

describe("uploadPromptFiles", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    ensureEmbedAuthFetchInterceptor.mockClear();
  });

  it("reads reference storage readiness from the Slides upload status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ referenceStorageReady: false }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(isReferenceStorageReady()).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/uploads/status"),
      { credentials: "include" },
    );
    expect(ensureEmbedAuthFetchInterceptor).toHaveBeenCalledOnce();
  });

  it.each([
    [401, "reference_storage_auth_required", false],
    [503, "reference_storage_http_failed", false],
  ])(
    "classifies storage status HTTP %s separately from transport errors",
    async (status, code, isNetworkError) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status })),
      );

      const error = await isReferenceStorageReady().catch((cause) => cause);
      expect(error).toMatchObject({
        code,
        message: "Reference file storage status could not be verified",
      });
      expect(isPromptUploadNetworkError(error)).toBe(isNetworkError);
      expect(isPromptUploadAuthRequiredError(error)).toBe(status === 401);
      expect(isPromptUploadStorageStatusError(error)).toBe(status === 503);
    },
  );

  it.each([
    [new Response("not-json", { status: 200 })],
    [new Response(JSON.stringify({ ready: true }), { status: 200 })],
  ])(
    "classifies malformed storage status responses as contract errors",
    async (response) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      const error = await isReferenceStorageReady().catch((cause) => cause);
      expect(error).toMatchObject({
        code: "reference_storage_contract_failed",
        message: "Reference file storage status could not be verified",
      });
      expect(isPromptUploadNetworkError(error)).toBe(false);
      expect(isPromptUploadAuthRequiredError(error)).toBe(false);
      expect(isPromptUploadStorageStatusError(error)).toBe(true);
    },
  );

  it("classifies a rejected status fetch as a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const error = await isReferenceStorageReady().catch((cause) => cause);
    expect(error).toMatchObject({
      code: "reference_storage_network_failed",
      message: "Reference file storage status could not be verified",
    });
    expect(isPromptUploadNetworkError(error)).toBe(true);
  });

  it("rejects more than 20 files before starting uploads", async () => {
    const fetchMock = vi.fn();
    stubReadyStorageUpload(fetchMock);
    const files = Array.from(
      { length: 21 },
      (_, index) => new File(["x"], `reference-${index}.pdf`),
    );

    await expect(uploadPromptFiles(files)).rejects.toThrow(
      "Too many files (max 20)",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the authenticated fetch boundary for reference uploads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            path: "uploads/reference.pdf",
            originalName: "reference.pdf",
            filename: "reference.pdf",
            type: "application/pdf",
            size: 3,
          },
        ]),
        { status: 200 },
      ),
    );
    stubReadyStorageUpload(fetchMock);

    await uploadPromptFiles([
      new File(["pdf"], "reference.pdf", { type: "application/pdf" }),
    ]);

    expect(ensureEmbedAuthFetchInterceptor).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/uploads"),
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    );
  });

  it("blocks eager attachments when reference storage is unavailable", async () => {
    const uploadFetch = vi.fn();
    const fetchMock = vi.fn(async (input: string | URL) => {
      if (input.toString().includes("/api/uploads/status")) {
        return new Response(JSON.stringify({ referenceStorageReady: false }), {
          status: 200,
        });
      }
      return uploadFetch(input);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PromptPopover
        open
        centered
        onOpenChange={vi.fn()}
        title="New presentation"
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("prompt-composer-attach"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/uploads/status"),
      { credentials: "include" },
    );
    expect(uploadFetch).not.toHaveBeenCalled();
  });

  it("keeps hosted images URL-only while adding bytes for unhosted images", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            path: "uploads/hosted.png",
            url: "https://cdn.example.test/hosted.png",
            originalName: "hosted.png",
            filename: "hosted.png",
            type: "image/png",
            size: 5,
          },
          {
            path: "uploads/inline.jpg",
            originalName: "inline.jpg",
            filename: "inline.jpg",
            type: "image/jpeg",
            size: 5,
          },
        ]),
        { status: 200 },
      ),
    );
    stubReadyStorageUpload(fetchMock);

    const uploads = await uploadPromptFiles([
      new File(["hosted"], "hosted.png", { type: "image/png" }),
      new File(["inline"], "inline.jpg", { type: "image/jpeg" }),
    ]);

    expect(uploads[0]).toMatchObject({
      url: "https://cdn.example.test/hosted.png",
    });
    expect(uploads[0]?.dataUrl).toBeUndefined();
    expect(uploads[1]?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("preserves selection order across multipart and chunked uploads", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.includes("/api/uploads-chunked/start")) {
          return new Response(JSON.stringify({ uploadMode: "multipart" }), {
            status: 200,
          });
        }
        const formData = init?.body as FormData;
        const file = formData.get("files") as File;
        return new Response(
          JSON.stringify([
            {
              path: `uploads/${file.name}`,
              originalName: file.name,
              filename: file.name,
              type: file.type,
              size: file.size,
            },
          ]),
          { status: 200 },
        );
      },
    );
    stubReadyStorageUpload(fetchMock);
    const large = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.pptx");
    const small = new File(["pdf"], "small.pdf", {
      type: "application/pdf",
    });

    const uploads = await uploadPromptFiles([large, small]);

    expect(uploads.map((file) => file.originalName)).toEqual([
      "large.pptx",
      "small.pdf",
    ]);
  });

  it("classifies chunked upload network failures without exposing transport details", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString().includes("/api/uploads-chunked/start")) {
        return new Response(JSON.stringify({ sessionId: "upload-session" }), {
          status: 200,
        });
      }
      throw new TypeError("Failed to fetch");
    });
    stubReadyStorageUpload(fetchMock);

    await expect(
      uploadPromptFiles([
        new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.pptx"),
      ]),
    ).rejects.toMatchObject({ code: "reference_upload_network_failed" });
  });

  it("keeps oversized hosted images URL-only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            path: "uploads/large.png",
            url: "https://cdn.example.test/large.png",
            originalName: "large.png",
            filename: "large.png",
            type: "image/png",
            size: 750_000,
          },
        ]),
        { status: 200 },
      ),
    );
    stubReadyStorageUpload(fetchMock);

    const [upload] = await uploadPromptFiles([
      new File([new Uint8Array(750_000)], "large.png", {
        type: "image/png",
      }),
    ]);

    expect(upload).toMatchObject({
      url: "https://cdn.example.test/large.png",
    });
    expect(upload.dataUrl).toBeUndefined();
  });

  it("caps aggregate inline image fallbacks while preserving hosted URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          Array.from({ length: 5 }, (_, index) => ({
            path: `uploads/image-${index}.png`,
            ...(index === 0
              ? { url: `https://cdn.example.test/image-${index}.png` }
              : {}),
            originalName: `image-${index}.png`,
            filename: `image-${index}.png`,
            type: "image/png",
            size: 600_000,
          })),
        ),
        { status: 200 },
      ),
    );
    stubReadyStorageUpload(fetchMock);

    const uploads = await uploadPromptFiles(
      Array.from(
        { length: 5 },
        (_, index) =>
          new File([new Uint8Array(600_000)], `image-${index}.png`, {
            type: "image/png",
          }),
      ),
    );

    expect(uploads.filter((file) => file.dataUrl)).toHaveLength(3);
    expect(uploads[0]?.dataUrl).toBeUndefined();
    expect(uploads[0]).toMatchObject({
      url: "https://cdn.example.test/image-0.png",
    });
    expect(uploads[4]?.dataUrl).toBeUndefined();
  });
});

describe.each(["popover", "inline"] as const)(
  "PromptPopover %s presentation",
  (presentation) => {
    afterEach(() => cleanup());

    function renderPopover(
      onImport: React.ComponentProps<typeof PromptPopover>["onImport"],
    ) {
      return render(
        <PromptPopover
          presentation={presentation}
          open
          centered
          onOpenChange={vi.fn()}
          title="New presentation"
          onSubmit={vi.fn()}
          onSkip={vi.fn()}
          skipLabel="Skip prompt"
          onImport={onImport}
          importFromLabel="Import from"
          importingLabel="Importing..."
        />,
      );
    }

    it("takes over the popover with a Google Slides URL form", () => {
      renderPopover(vi.fn());

      expect(screen.getByText("Or import from")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Slides" }));

      expect(
        screen.getByRole("textbox", { name: "Paste a Google Slides link" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Back to prompt" }),
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Prompt composer" }),
      ).toBeNull();
      expect(screen.getByTestId("google-drive-connection-cta")).toBeTruthy();
    });

    it("passes an uploaded PDF to the direct import callback", async () => {
      const onImport = vi.fn().mockResolvedValue(true);
      renderPopover(onImport);

      fireEvent.click(screen.getByRole("button", { name: "PDF" }));
      expect(screen.getByRole("button", { name: "Upload PDF" })).toBeTruthy();

      const file = new File(["pdf"], "reference.pdf", {
        type: "application/pdf",
      });
      fireEvent.change(screen.getAllByLabelText("Import file")[0], {
        target: { files: [file] },
      });

      await waitFor(() => {
        expect(onImport).toHaveBeenCalledWith({ kind: "pdf", files: [file] });
      });
    });

    it("shows the importing state while a direct import is pending", async () => {
      let resolveImport!: (value: boolean) => void;
      const onImport = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveImport = resolve;
          }),
      );
      renderPopover(onImport);

      fireEvent.click(screen.getByRole("button", { name: "Slides" }));
      fireEvent.change(
        screen.getByRole("textbox", { name: "Paste a Google Slides link" }),
        { target: { value: "https://docs.google.com/presentation/d/example" } },
      );
      fireEvent.click(screen.getByRole("button", { name: "Import" }));

      expect(screen.getByRole("status").textContent).toContain("Importing...");
      expect(screen.queryByRole("button", { name: "Skip prompt" })).toBeNull();

      resolveImport(true);
      await waitFor(() => {
        expect(onImport).toHaveBeenCalledWith({
          kind: "google-slides",
          url: "https://docs.google.com/presentation/d/example",
        });
      });
    });

    it("shows a busy state while prompt attachments are uploading", async () => {
      let resolveUpload!: (response: Response) => void;
      const fetchMock = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveUpload = resolve;
          }),
      );
      stubReadyStorageUpload(fetchMock);
      const onSubmit = vi.fn();

      render(
        <PromptPopover
          open
          centered
          onOpenChange={vi.fn()}
          title="New presentation"
          onSubmit={onSubmit}
          onSkip={vi.fn()}
          skipLabel="Skip prompt"
        />,
      );

      const composer = screen.getByRole("button", { name: "Prompt composer" });
      fireEvent.click(composer);

      expect(screen.getByRole("status").textContent).toContain("Uploading...");
      expect((composer as HTMLButtonElement).disabled).toBe(true);
      await waitFor(() => expect(resolveUpload).toBeTypeOf("function"));

      resolveUpload(
        new Response(
          JSON.stringify([
            {
              path: "uploads/large.pdf",
              originalName: "large.pdf",
              filename: "large.pdf",
              type: "application/pdf",
              size: 3,
            },
          ]),
          { status: 200 },
        ),
      );
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          "  make a deck  \n",
          [expect.objectContaining({ originalName: "large.pdf" })],
          expect.objectContaining({
            commit: expect.any(Function),
            discard: expect.any(Function),
            attachments: [],
          }),
          {
            model: "gpt-5.6-terra",
            engine: "builder",
            effort: "high",
          },
        );
      });
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("hands off signed-out prompts before uploading files", async () => {
      const fetchMock = vi.fn();
      stubReadyStorageUpload(fetchMock);
      const onBeforeUpload = vi.fn(() => false);
      const onSubmit = vi.fn();

      render(
        <PromptPopover
          open
          centered
          onOpenChange={vi.fn()}
          title="New presentation"
          onSubmit={onSubmit}
          onSkip={vi.fn()}
          skipLabel="Skip prompt"
          onBeforeUpload={onBeforeUpload}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Prompt composer" }));

      await waitFor(() => {
        expect(onBeforeUpload).toHaveBeenCalledWith(
          "  make a deck  \n",
          [expect.objectContaining({ name: "large.pdf" })],
          undefined,
          [],
          {
            model: "gpt-5.6-terra",
            engine: "builder",
            effort: "high",
          },
        );
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("hands off the selected model when an attachment triggers sign-in", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const onBeforeUpload = vi.fn(() => false);

      render(
        <PromptPopover
          open
          centered
          onOpenChange={vi.fn()}
          title="New presentation"
          onSubmit={vi.fn()}
          onSkip={vi.fn()}
          skipLabel="Skip prompt"
          onBeforeUpload={onBeforeUpload}
        />,
      );

      fireEvent.click(screen.getByTestId("prompt-composer-attach"));

      await waitFor(() => {
        expect(onBeforeUpload).toHaveBeenCalledWith(
          "",
          [expect.objectContaining({ name: "large.pdf" })],
          undefined,
          undefined,
          {
            model: "gpt-5.6-terra",
            engine: "builder",
            effort: "high",
          },
        );
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("starts uploading when a prompt attachment is added and reuses it on submit", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              path: "uploads/large.pdf",
              originalName: "large.pdf",
              filename: "large.pdf",
              type: "application/pdf",
              size: 3,
            },
          ]),
          { status: 200 },
        ),
      );
      stubReadyStorageUpload(fetchMock);
      const onSubmit = vi.fn();

      render(
        <PromptPopover
          open
          centered
          onOpenChange={vi.fn()}
          title="New presentation"
          onSubmit={onSubmit}
          onSkip={vi.fn()}
          skipLabel="Skip prompt"
        />,
      );

      fireEvent.click(screen.getByTestId("prompt-composer-attach"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

      fireEvent.click(screen.getByRole("button", { name: "Prompt composer" }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  },
);

describe("inline prompt starters", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([false, true])(
    "uses the standard context menu without a custom attach control (context: %s)",
    (hasContext) => {
      const entries = [{ id: "design", label: "Design", children: [] }];
      const context = hasContext
        ? ({
            props: { contextItems: [], contextMenuItems: entries },
            beforeSend: vi.fn(),
            dialogs: null,
          } as unknown as ReturnType<typeof useSlidesComposerContext>)
        : undefined;
      render(
        <PromptPopover
          open
          presentation="inline"
          title="New presentation"
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          context={context}
        />,
      );
      expect(promptComposerProps.mock.lastCall![0].contextMenuItems).toEqual(
        hasContext ? entries : [],
      );
      expect(
        promptComposerProps.mock.lastCall![0].attachButton,
      ).toBeUndefined();
      expect(
        promptComposerProps.mock.lastCall![0].attachmentAdapter?.accept,
      ).toBe(SLIDES_REFERENCE_FILE_ACCEPT);
    },
  );

  it.each(["inline", "popover"] as const)(
    "does not expose Skip prompt in the %s presentation",
    (presentation) => {
      render(
        <PromptPopover
          presentation={presentation}
          open
          title="New presentation"
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          onImport={vi.fn()}
          importFromLabel="Import from"
          onSkip={vi.fn()}
          skipLabel="Skip prompt"
        />,
      );
      expect(screen.queryByRole("button", { name: "Skip prompt" })).toBeNull();
    },
  );

  it("forwards submission-only provider gating without disabling staging or imports, and never offers Skip", async () => {
    const onImport = vi.fn().mockResolvedValue(false);
    const onSkip = vi.fn();
    render(
      <PromptPopover
        presentation="inline"
        open
        title="New presentation"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        submissionDisabled
        showModelSelector={false}
        modelStatusChecksEnabled={false}
        onImport={onImport}
        importFromLabel="Import from"
        onSkip={onSkip}
        skipLabel="Skip prompt"
      />,
    );
    expect(promptComposerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        disabled: false,
        submissionDisabled: true,
        showModelSelector: false,
        modelStatusChecksEnabled: false,
      }),
    );
    expect(
      (screen.getByTestId("prompt-composer") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("prompt-composer-attach") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    for (const name of ["PDF", "Slides", "PPT"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(false);
    }
    expect(screen.queryByRole("button", { name: "Skip prompt" })).toBeNull();
    expect(onSkip).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    fireEvent.change(screen.getAllByLabelText("Import file")[0], {
      target: { files: [promptFile] },
    });
    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith({
        kind: "pdf",
        files: [promptFile],
      }),
    );
  });

  it("stages an attachment before connection while blocking imperative quick-start submission", async () => {
    const onSubmit = vi.fn();
    const controllerRef = createRef<PromptPopoverHandle>();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            path: "uploads/large.pdf",
            originalName: "large.pdf",
            filename: "large.pdf",
            type: "application/pdf",
            size: 3,
          },
        ]),
        { status: 200 },
      ),
    );
    stubReadyStorageUpload(fetchMock);
    render(
      <PromptPopover
        presentation="inline"
        open
        title="New presentation"
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        submissionDisabled
        controllerRef={controllerRef}
        showModelSelector={false}
        modelStatusChecksEnabled={false}
      />,
    );
    await act(async () =>
      expect(
        await controllerRef.current!.submitSource("Create a presentation", []),
      ).toBe(false),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("prompt-composer-attach"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(promptComposerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ disabled: false, submissionDisabled: true }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves the editor's provider defaults unchanged", () => {
    render(
      <PromptPopover
        open
        centered
        title="New presentation"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(promptComposerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        disabled: false,
        showModelSelector: undefined,
        modelStatusChecksEnabled: undefined,
      }),
    );
  });

  it("seeds and focuses in place without submitting or closing on outside interaction", () => {
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    const props = {
      open: true,
      presentation: "inline" as const,
      title: "New presentation",
      onSubmit,
      onOpenChange,
      draftScope: "slides-new-deck",
    };
    const { container, rerender } = render(<PromptPopover {...props} />);
    expect(container.querySelector('[role="group"]')).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    const originalInput = screen.getByRole("textbox", { name: "Prompt" });

    rerender(
      <PromptPopover
        {...props}
        initialText="Create a pitch deck about "
        initialTextKey={1}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Prompt" })).toBe(originalInput);
    expect((originalInput as HTMLTextAreaElement).value).toBe(
      "Create a pitch deck about ",
    );
    expect(document.activeElement).toBe(originalInput);
    fireEvent.mouseDown(document.body);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("retains the upload and model selection across a starter and reference-step return", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            path: "uploads/large.pdf",
            originalName: "large.pdf",
            filename: "large.pdf",
            type: "application/pdf",
            size: 3,
          },
        ]),
        { status: 200 },
      ),
    );
    stubReadyStorageUpload(fetchMock);
    const onSubmit = vi.fn().mockReturnValue("retain");
    const props = {
      presentation: "inline" as const,
      title: "New presentation",
      onSubmit,
      onOpenChange: vi.fn(),
      draftScope: "slides-new-deck",
    };
    const { rerender } = render(<PromptPopover {...props} open />);
    fireEvent.click(screen.getByTestId("prompt-composer-attach"));
    await waitFor(() =>
      expect(
        (screen.getByTestId("prompt-composer") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    rerender(
      <PromptPopover
        {...props}
        open
        initialText="Create an update"
        initialTextKey={1}
      />,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("prompt-composer"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    rerender(<PromptPopover {...props} open={false} />);
    rerender(
      <PromptPopover
        {...props}
        open
        initialText="Create an update"
        initialTextKey={2}
      />,
    );
    fireEvent.click(screen.getByTestId("prompt-composer"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[1][3]).toEqual({
      model: "gpt-5.6-terra",
      engine: "builder",
      effort: "high",
    });
  });

  it("submits a structured source through the real controller with current text, files, model and context", async () => {
    const sourceFile = new File(["source"], "source.pdf", {
      type: "application/pdf",
    });
    stubReadyStorageUpload(
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            [promptFile, sourceFile].map((file) => ({
              path: `uploads/${file.name}`,
              originalName: file.name,
              filename: file.name,
              type: file.type,
              size: file.size,
            })),
          ),
          { status: 200 },
        ),
      ),
    );
    const items = [
      {
        key: "slides:deck:",
        title: "Deck",
        context: "Measured typography",
        status: "ready" as const,
      },
    ];
    const selection = {
      designSystemId: null,
      references: [{ source: "slides" as const, id: "deck", title: "Deck" }],
    };
    const beforeSend = vi
      .fn()
      .mockResolvedValue({ selection, items, text: "Reference context" });
    const context = {
      props: { contextItems: items },
      beforeSend,
      dialogs: null,
    } as unknown as ReturnType<typeof useSlidesComposerContext>;
    const controllerRef = createRef<PromptPopoverHandle>();
    const onSubmit = vi.fn().mockReturnValue("retain");
    render(
      <PromptPopover
        open
        presentation="inline"
        title="New presentation"
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        context={context}
        controllerRef={controllerRef}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), {
      target: { value: "Keep our existing brand and audience" },
    });
    await act(async () =>
      expect(
        await controllerRef.current!.submitSource(
          "Summarize the PDF",
          [sourceFile],
          "Hidden source data",
        ),
      ).toBe(true),
    );
    expect(beforeSend).toHaveBeenCalledWith(items);
    expect(onSubmit).toHaveBeenCalledWith(
      "Keep our existing brand and audience\n\nSummarize the PDF",
      expect.arrayContaining([
        expect.objectContaining({ originalName: "large.pdf" }),
        expect.objectContaining({ originalName: "source.pdf" }),
      ]),
      expect.objectContaining({
        context: "Hidden source data",
        attachments: expect.arrayContaining([
          expect.objectContaining({ name: "source.pdf" }),
        ]),
      }),
      expect.objectContaining({
        model: "gpt-5.6-terra",
        engine: "builder",
        effort: "high",
        contextItems: items,
        slidesContext: selection,
      }),
    );
    expect(onSubmit.mock.calls[0][0]).not.toContain("Hidden source data");
  });

  it("does not upload or submit when context revalidation fails", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onSubmit = vi.fn(),
      controllerRef = createRef<PromptPopoverHandle>();
    const context = {
      props: { contextItems: [] },
      beforeSend: vi
        .fn()
        .mockRejectedValue(new Error("Reference access revoked")),
      dialogs: null,
    } as unknown as ReturnType<typeof useSlidesComposerContext>;
    render(
      <PromptPopover
        open
        presentation="inline"
        title="New presentation"
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        context={context}
        controllerRef={controllerRef}
      />,
    );
    await act(async () =>
      expect(
        await controllerRef.current!.submitSource(
          "Make a presentation",
          [],
          "Private notes",
        ),
      ).toBe(false),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
