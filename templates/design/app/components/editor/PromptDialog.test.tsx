// @vitest-environment happy-dom

import type { PromptComposerProps } from "@agent-native/core/client/composer";
import {
  act,
  createRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PromptPopover from "./PromptDialog";

interface ComposerStubProps {
  disabled?: boolean;
  submissionDisabled?: boolean;
  attachButton?: unknown;
  contextMenuItems?: PromptComposerProps["contextMenuItems"];
  attachmentAdapter?: PromptComposerProps["attachmentAdapter"];
  inlineTextAttachments?: boolean;
  maxDocumentAttachmentBytes?: number;
  contextItems?: unknown[];
  onRemoveContextItem?: (key: string) => void;
  draftScope?: string;
  initialText?: string;
  initialTextKey?: string | number;
  composerRef?: React.Ref<{ focus: () => void }>;
  layoutVariant?: string;
  onTextChange?: (text: string) => void;
  onAttachmentsChange?: (files: File[]) => void;
  onSubmit: (
    text: string,
    files: File[],
    references: unknown[],
    options: Record<string, unknown>,
  ) => void | Promise<void>;
  submitting?: boolean;
}
const mockComposer = vi.hoisted(() => ({
  current: null as ComposerStubProps | null,
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appBasePath: () => "",
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string, options?: Record<string, unknown>): string =>
      options ? `${key}:${JSON.stringify(options)}` : key,
}));

const mockActiveOrg = vi.hoisted(() => ({
  current: { orgId: "org-a" } as { orgId: string | null } | undefined,
}));
const mockOrgPending = vi.hoisted(() => ({ current: false }));
const mockOrgQueryOptions = vi.hoisted(() => ({
  values: [] as Array<{ enabled?: boolean } | undefined>,
}));
const mockEagerUpload = vi.hoisted(() => ({
  implementation: async (files: File[]) =>
    files.map((file) => ({ path: `/uploads/${file.name}` })),
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: (options?: { enabled?: boolean }) => {
    mockOrgQueryOptions.values.push(options);
    return {
      data: mockActiveOrg.current,
      isPending: mockOrgPending.current,
    };
  },
}));

vi.mock("@agent-native/core/client/composer", () => ({
  PromptComposer: (props: ComposerStubProps) => {
    mockComposer.current = props;
    const [text, setText] = useState("");
    const [files, setFiles] = useState<File[]>([]);
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const appliedSeedKey = useRef<string | number | undefined>(undefined);
    useImperativeHandle(props.composerRef, () => ({
      focus: () => editorRef.current?.focus(),
    }));
    useEffect(() => {
      const key = props.initialTextKey ?? props.initialText;
      if (props.initialText !== undefined && appliedSeedKey.current !== key) {
        appliedSeedKey.current = key;
        setText(props.initialText);
      }
    }, [props.initialText, props.initialTextKey]);
    return (
      <div
        data-testid="prompt-composer"
        data-draft-scope={props.draftScope ?? ""}
        data-initial-text={props.initialText ?? ""}
        data-initial-text-key={String(props.initialTextKey ?? "")}
        data-disabled={String(Boolean(props.disabled))}
        data-layout-variant={props.layoutVariant}
      >
        <textarea
          ref={editorRef}
          data-testid="prompt-editor"
          disabled={props.disabled}
          value={text}
          onInput={(event) => {
            setText(event.currentTarget.value);
            props.onTextChange?.(event.currentTarget.value);
          }}
        />
        <input
          data-testid="prompt-file-input"
          type="file"
          disabled={props.disabled}
          onChange={(event) => {
            const nextFiles = Array.from(event.currentTarget.files ?? []);
            setFiles(nextFiles);
            props.onAttachmentsChange?.(nextFiles);
          }}
        />
        {files.map((file) => (
          <button
            key={file.name}
            data-testid="remove-file"
            onClick={() => {
              const remaining = files.filter((item) => item !== file);
              setFiles(remaining);
              props.onAttachmentsChange?.(remaining);
            }}
          >
            {file.name}
          </button>
        ))}
        <button
          type="button"
          data-testid="composer-submit"
          disabled={
            props.disabled || props.submitting || props.submissionDisabled
          }
          onClick={() =>
            Promise.resolve(
              props.onSubmit(text || "  hello world  \n", files, [], {}),
            ).catch(() => {})
          }
        >
          submit
        </button>
      </div>
    );
  },
  useEagerFileUploads: () => {
    const [uploading, setUploading] = useState(false);
    const uploadFiles = useCallback(async (files: File[]) => {
      if (files.length === 0) return [];
      setUploading(true);
      try {
        return await mockEagerUpload.implementation(files);
      } finally {
        setUploading(false);
      }
    }, []);
    return {
      commitFiles: () => {},
      discardFiles: () => {},
      retainFiles: () => {},
      syncFiles: () => {},
      uploadFiles,
      uploading,
      reset: () => {},
    };
  },
}));

vi.mock("@agent-native/core/embedding/react", () => ({
  EmbeddedApp: () => null,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: unknown }) =>
    open ? <div>{children as never}</div> : null,
  DialogContent: ({ children }: { children: unknown }) => (
    <div>{children as never}</div>
  ),
  DialogTitle: ({ children }: { children: unknown }) => (
    <div>{children as never}</div>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: unknown }) => (
    <div>{children as never}</div>
  ),
  PopoverAnchor: ({ children }: { children?: unknown }) => (
    <>{children as never}</>
  ),
  PopoverContent: ({ children }: { children: unknown }) => (
    <div>{children as never}</div>
  ),
  PopoverTrigger: ({ children }: { children: unknown }) => (
    <>{children as never}</>
  ),
}));

vi.mock("@/components/templates/TemplatePreview", () => ({
  TemplatePreview: ({ title }: { title: string }) => (
    <span data-template-preview={title} />
  ),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

let cleanup: (() => Promise<void>) | undefined;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockActiveOrg.current = { orgId: "org-a" };
  mockOrgPending.current = false;
  mockOrgQueryOptions.values = [];
  mockEagerUpload.implementation = async (files) =>
    files.map((file) => ({ path: `/uploads/${file.name}` }));
});

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  root = undefined;
  container = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  toastError.mockClear();
});

async function renderPopover(props: Record<string, unknown>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  cleanup = async () => {
    await act(async () => root?.unmount());
    container?.remove();
  };
  await act(async () => {
    root!.render(
      <PromptPopover
        open
        onOpenChange={() => {}}
        title="Generate design"
        onSubmit={() => {}}
        {...props}
      />,
    );
  });
}

describe("PromptPopover inline home", () => {
  it.each([false, true])(
    "uses one shared Upload menu and retains an eager batch (inline: %s)",
    async (inline) => {
      const onSubmit = vi.fn();
      const upload = vi.fn(async (files: File[]) =>
        files.map((file) => ({ path: `/uploads/${file.name}` })),
      );
      mockEagerUpload.implementation = upload;
      await renderPopover({ inline, onSubmit });
      expect(mockComposer.current!.attachButton).toBeUndefined();
      expect(mockComposer.current!.contextMenuItems).toEqual([]);
      expect(mockComposer.current!.attachmentAdapter).toBeDefined();
      expect(mockComposer.current!.inlineTextAttachments).toBe(false);
      expect(mockComposer.current!.maxDocumentAttachmentBytes).toBe(
        4 * 1024 * 1024,
      );
      expect(container!.querySelector('input[hidden][type="file"]')).toBeNull();
      const files = [
        new File(["first"], "first.txt"),
        new File(["second"], "second.txt"),
      ];
      const input = container!.querySelector<HTMLInputElement>(
        '[data-testid="prompt-file-input"]',
      )!;
      await act(async () => {
        Object.defineProperty(input, "files", { value: files });
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(upload).toHaveBeenCalledWith(files);
      await act(async () =>
        mockComposer.current!.onSubmit("Keep batch", files, [], {}),
      );
      expect(onSubmit).toHaveBeenCalledWith(
        "Keep batch",
        [{ path: "/uploads/first.txt" }, { path: "/uploads/second.txt" }],
        {},
      );
    },
  );
  it("keeps only Upload file then Design in the context root, without assets or blank/template actions", async () => {
    await renderPopover({
      inline: true,
      onSkip: vi.fn(),
      contextMenuItems: [{ id: "design", label: "Design", children: [] }],
    });
    expect(
      mockComposer.current!.contextMenuItems?.map((item) => item.id),
    ).toEqual(["design"]);
    expect(mockComposer.current!.attachButton).toBeUndefined();
  });
  it("keeps Pick asset and Skip prompt out of the legacy attachment menu too", async () => {
    await renderPopover({ onSkip: vi.fn() });
    expect(mockComposer.current!.contextMenuItems).toEqual([]);
    expect(mockComposer.current!.attachButton).toBeUndefined();
    expect(container!.textContent).not.toContain("promptDialog.pickAsset");
    expect(container!.textContent).not.toContain("promptDialog.skipPrompt");
  });
  it("keeps drafts, files and context editable while only submission is disabled", async () => {
    const onSubmit = vi.fn();
    const onRemoveContextItem = vi.fn();
    const props = {
      inline: true,
      onSubmit,
      contextMenuItems: [],
      contextItems: [
        { key: "reference", title: "Reference", context: "Source" },
      ],
      onRemoveContextItem,
    };
    await renderPopover({ ...props, submissionDisabled: true });
    const editor = container!.querySelector<HTMLTextAreaElement>(
      '[data-testid="prompt-editor"]',
    )!;
    const input = container!.querySelector<HTMLInputElement>(
      '[data-testid="prompt-file-input"]',
    )!;
    const submit = container!.querySelector<HTMLButtonElement>(
      '[data-testid="composer-submit"]',
    )!;
    expect(editor.disabled).toBe(false);
    expect(input.disabled).toBe(false);
    expect(submit.disabled).toBe(true);
    expect(mockComposer.current!.submissionDisabled).toBe(true);
    expect(mockComposer.current!.contextMenuItems).toEqual([]);
    expect(mockComposer.current!.contextItems).toEqual(props.contextItems);
    const file = new File(["brief"], "brief.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () => {
      editor.value = "Draft before connecting";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      mockComposer.current!.onRemoveContextItem!("reference");
      submit.click();
    });
    expect(onRemoveContextItem).toHaveBeenCalledWith("reference");
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => {
      root!.render(
        <PromptPopover
          open
          onOpenChange={() => {}}
          title="Generate design"
          {...props}
          submissionDisabled={false}
        />,
      );
    });
    expect(editor.value).toBe("Draft before connecting");
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    expect(onSubmit).toHaveBeenCalledWith(
      "Draft before connecting",
      [{ path: "/uploads/brief.txt" }],
      {},
    );
  });

  it("rejects failed quick-start handoffs without clearing typed draft, files, model, or frozen context", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValueOnce(undefined);
    const onSubmitError = vi.fn();
    const freshContext = Object.freeze([
      {
        key: "reference",
        title: "Reference",
        context: "Fresh bounded reference",
        status: "ready" as const,
      },
    ]);
    const beforeSubmitContext = vi.fn().mockResolvedValue(freshContext);
    await renderPopover({
      inline: true,
      onSubmit,
      onSubmitError,
      beforeSubmitContext,
    });
    const editor = container!.querySelector<HTMLTextAreaElement>(
      '[data-testid="prompt-editor"]',
    )!;
    await act(async () => {
      editor.value = "Keep my typed draft";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const file = new File(["reference"], "reference.png", {
      type: "image/png",
    });
    const input = container!.querySelector<HTMLInputElement>(
      '[data-testid="prompt-file-input"]',
    )!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    const options = {
      model: "selected-model",
      engine: "selected-engine",
      effort: "high",
      contextItems: [
        { key: "reference", title: "Reference", context: "Previous reference" },
      ],
    };
    await act(async () => {
      await expect(
        mockComposer.current!.onSubmit(
          "Localized quick start",
          [file],
          [],
          options,
        ),
      ).rejects.toThrow("save failed");
    });
    expect(editor.value).toBe("Keep my typed draft");
    expect(
      container!.querySelector('[data-testid="remove-file"]')?.textContent,
    ).toBe("reference.png");
    expect(onSubmitError).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith(
      "Localized quick start",
      [{ path: "/uploads/reference.png" }],
      { ...options, contextItems: freshContext },
    );
    expect(beforeSubmitContext).toHaveBeenCalledWith(options.contextItems);
    await act(async () => {
      await mockComposer.current!.onSubmit(
        "Keep my typed draft",
        [file],
        [],
        options,
      );
    });
    expect(onSubmit).toHaveBeenLastCalledWith(
      "Keep my typed draft",
      [{ path: "/uploads/reference.png" }],
      { ...options, contextItems: freshContext },
    );
  });

  it("keeps the existing aggregate cap even when files have already uploaded in separate eager batches", async () => {
    const onSubmit = vi.fn();
    const beforeSubmitContext = vi.fn();
    await renderPopover({ inline: true, onSubmit, beforeSubmitContext });
    const files = [
      new File([new Uint8Array(3 * 1024 * 1024)], "first.tsx"),
      new File([new Uint8Array(2 * 1024 * 1024)], "second.tsx"),
    ];
    await act(async () => {
      mockComposer.current!.onAttachmentsChange!([files[0]]);
      mockComposer.current!.onAttachmentsChange!(files);
    });
    await act(async () => {
      await expect(
        mockComposer.current!.onSubmit("Keep the draft", files, [], {}),
      ).rejects.toThrow("promptDialog.attachmentsTooLarge");
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(beforeSubmitContext).not.toHaveBeenCalled();
    expect(
      container!.querySelector<HTMLTextAreaElement>(
        '[data-testid="prompt-editor"]',
      )!.value,
    ).toBe("Keep the draft");
  });

  it("keeps rejected staged files removable without resubmitting the rejected file", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("Host rejected attachment"));
    await renderPopover({ inline: true, onSubmit });
    const file = new File(["source"], "app.tsx", {
      type: "application/octet-stream",
    });
    const input = container!.querySelector<HTMLInputElement>(
      '[data-testid="prompt-file-input"]',
    )!;
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    await act(async () => {
      await expect(
        mockComposer.current!.onSubmit("Preserve draft", [file], [], {}),
      ).rejects.toThrow("Host rejected attachment");
    });
    const remove = container!.querySelector<HTMLButtonElement>(
      '[data-testid="remove-file"]',
    )!;
    expect(remove.textContent).toBe("app.tsx");
    await act(async () => remove.click());
    expect(container!.querySelector('[data-testid="remove-file"]')).toBeNull();
    onSubmit.mockResolvedValue(undefined);
    await act(async () =>
      container!
        .querySelector<HTMLButtonElement>('[data-testid="composer-submit"]')!
        .click(),
    );
    expect(onSubmit).toHaveBeenLastCalledWith("Preserve draft", [], {});
  });

  it("does not hand off an upload or restore old text into a different identity", async () => {
    let resolveUpload!: (files: Array<{ path: string }>) => void;
    mockEagerUpload.implementation = () =>
      new Promise((resolve) => {
        resolveUpload = resolve;
      });
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    await renderPopover({
      inline: true,
      submissionIdentity: "first",
      onSubmit,
    });
    const file = new File(["reference"], "reference.png");
    let pending!: Promise<void>;
    await act(async () => {
      pending = Promise.resolve(
        mockComposer.current!.onSubmit("Private draft", [file], [], {}),
      );
    });
    const rejection = expect(pending).rejects.toThrow();
    await act(async () =>
      root!.render(
        <PromptPopover
          inline
          open
          title="Generate design"
          submissionIdentity="second"
          initialText="New account draft"
          initialTextKey={1}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
        />,
      ),
    );
    await act(async () => resolveUpload([{ path: "/uploads/reference.png" }]));
    await rejection;
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      container!.querySelector<HTMLTextAreaElement>(
        '[data-testid="prompt-editor"]',
      )?.value,
    ).toBe("New account draft");
  });
  it("seeds and focuses the shared composer without remounting or losing eager attachments", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const composerRef = createRef<{ focus: () => void }>();
    await renderPopover({
      inline: true,
      draftScope: "design:new:0",
      onSubmit,
      onOpenChange,
      composerRef,
    });
    const editor = container!.querySelector<HTMLTextAreaElement>(
      '[data-testid="prompt-editor"]',
    )!;
    const fileInput = container!.querySelector<HTMLInputElement>(
      '[data-testid="prompt-file-input"]',
    )!;
    const file = new File(["image"], "reference.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () =>
      fileInput.dispatchEvent(new Event("change", { bubbles: true })),
    );

    await act(async () => {
      root!.render(
        <PromptPopover
          inline
          open
          title="Generate design"
          draftScope="design:new:0"
          onSubmit={onSubmit}
          onOpenChange={onOpenChange}
          composerRef={composerRef as never}
          placeholder="Adapt the selected template"
          initialText="Un tableau de bord"
          initialTextKey={1}
        />,
      );
      await Promise.resolve();
    });
    composerRef.current?.focus();
    expect(container!.querySelector('[data-testid="prompt-editor"]')).toBe(
      editor,
    );
    expect(editor.value).toBe("Un tableau de bord");
    expect(document.activeElement).toBe(editor);
    expect(
      container!
        .querySelector('[data-testid="prompt-composer"]')
        ?.getAttribute("data-layout-variant"),
    ).toBe("hero");
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () =>
      container!
        .querySelector<HTMLButtonElement>('[data-testid="composer-submit"]')
        ?.click(),
    );
    expect(onSubmit).toHaveBeenCalledWith(
      "Un tableau de bord",
      [{ path: "/uploads/reference.png" }],
      expect.anything(),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("restores a failed inline submission and accepts the next seed without closing", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("offline"));
    const onOpenChange = vi.fn();
    await renderPopover({
      inline: true,
      onSubmit,
      onOpenChange,
      initialText: "First draft",
      initialTextKey: 1,
    });
    await act(async () =>
      container!
        .querySelector<HTMLButtonElement>('[data-testid="composer-submit"]')
        ?.click(),
    );
    expect(toastError).toHaveBeenCalledWith("offline");
    expect(
      container!.querySelector<HTMLTextAreaElement>(
        '[data-testid="prompt-editor"]',
      )?.value,
    ).toBe("First draft");
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () =>
      root!.render(
        <PromptPopover
          inline
          open
          title="Generate design"
          onSubmit={onSubmit}
          onOpenChange={onOpenChange}
          initialText="Second draft"
          initialTextKey={2}
        />,
      ),
    );
    expect(
      container!.querySelector<HTMLTextAreaElement>(
        '[data-testid="prompt-editor"]',
      )?.value,
    ).toBe("Second draft");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not replace a newer starter when an older submission fails late", async () => {
    let rejectSubmit!: (error: Error) => void;
    const pendingSubmit = new Promise<void>((_resolve, reject) => {
      rejectSubmit = reject;
    });
    const onSubmit = vi.fn(() => pendingSubmit);
    const onOpenChange = vi.fn();
    await renderPopover({
      inline: true,
      onSubmit,
      onOpenChange,
      initialText: "First draft",
      initialTextKey: 1,
    });
    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="composer-submit"]')
        ?.click();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => {
      root!.render(
        <PromptPopover
          inline
          open
          title="Generate design"
          onSubmit={onSubmit}
          onOpenChange={onOpenChange}
          initialText="Second draft"
          initialTextKey={2}
        />,
      );
    });
    await act(async () => {
      rejectSubmit(new Error("late failure"));
    });
    expect(toastError).toHaveBeenCalledWith("late failure");
    expect(
      container!.querySelector<HTMLTextAreaElement>(
        '[data-testid="prompt-editor"]',
      )?.value,
    ).toBe("Second draft");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("PromptPopover draft isolation", () => {
  it("scopes the composer draft key to this popover's title by default", async () => {
    await renderPopover({ title: "Tweak design" });
    const composer = container!.querySelector(
      '[data-testid="prompt-composer"]',
    );
    expect(composer?.getAttribute("data-draft-scope")).toBe(
      "Tweak design:org-a",
    );
  });

  it("keeps host prompts anonymous without querying the active org", async () => {
    await renderPopover({ scopeDraftsToOrg: false });
    const composer = container!.querySelector(
      '[data-testid="prompt-composer"]',
    );

    expect(mockOrgQueryOptions.values).toContainEqual({ enabled: false });
    expect(composer?.getAttribute("data-draft-scope")).toBe(
      "Generate design:anonymous",
    );
  });

  it("prefers an explicit draftScope over the title default", async () => {
    await renderPopover({
      title: "Generate design",
      draftScope: "design:abc123:generate",
    });
    const composer = container!.querySelector(
      '[data-testid="prompt-composer"]',
    );
    expect(composer?.getAttribute("data-draft-scope")).toBe(
      "design:abc123:generate:org-a",
    );
  });

  it("changes the draft key when the active account switches, so a draft never leaks across accounts", async () => {
    mockActiveOrg.current = { orgId: "org-a" };
    await renderPopover({ title: "New design" });
    const composerBefore = container!.querySelector(
      '[data-testid="prompt-composer"]',
    );
    expect(composerBefore?.getAttribute("data-draft-scope")).toBe(
      "New design:org-a",
    );

    // Switching accounts (org.orgId changes) happens client-side with no
    // reload, so this must re-derive to a different key rather than keep
    // reading/writing the previous account's localStorage entry.
    mockActiveOrg.current = { orgId: "org-b" };
    await act(async () => {
      root!.render(
        <PromptPopover
          open
          onOpenChange={() => {}}
          title="New design"
          onSubmit={() => {}}
        />,
      );
    });

    const composerAfter = container!.querySelector(
      '[data-testid="prompt-composer"]',
    );
    expect(composerAfter?.getAttribute("data-draft-scope")).toBe(
      "New design:org-b",
    );
  });

  it("never falls back to the unscoped title key while the org query is still pending", async () => {
    // Before `useOrg` resolves we don't know which account this popover
    // belongs to. Falling back to the bare title key here would let this
    // popover read (or later leak) a different signed-in account's
    // abandoned draft, since that unscoped key predates org-scoping.
    mockOrgPending.current = true;
    mockActiveOrg.current = undefined;
    await renderPopover({ title: "New design" });
    const composer = container!.querySelector(
      '[data-testid="prompt-composer"]',
    );
    expect(composer?.getAttribute("data-draft-scope")).not.toBe("New design");
    expect(composer?.getAttribute("data-draft-scope")).toBe(
      "New design:pending",
    );
  });

  it("scopes users with no active org distinctly from both the pending and unscoped keys", async () => {
    mockOrgPending.current = false;
    mockActiveOrg.current = { orgId: null };
    await renderPopover({ title: "New design" });
    const composer = container!.querySelector(
      '[data-testid="prompt-composer"]',
    );
    expect(composer?.getAttribute("data-draft-scope")).toBe("New design:none");
  });
});

describe("PromptPopover submit failure recovery", () => {
  it("restores the typed prompt into the composer instead of losing it when onSubmit rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("network down"));
    await renderPopover({ onSubmit });

    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="composer-submit"]')
        ?.click();
    });
    // Let the async handleSubmit's rejection settle and re-render.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("network down");

    const composer = container!.querySelector(
      '[data-testid="prompt-composer"]',
    );
    // The composer optimistically clears its own text as soon as onSubmit is
    // invoked, so the popover must feed the failed prompt back in via
    // `initialText`/`initialTextKey` rather than let it vanish.
    expect(composer?.getAttribute("data-initial-text")).toBe(
      "  hello world  \n",
    );
    expect(composer?.getAttribute("data-initial-text-key")).not.toBe("");
    expect(composer?.getAttribute("data-initial-text-key")).not.toBe("0");
  });

  it("does not surface a restore when onSubmit succeeds", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await renderPopover({ onSubmit });

    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="composer-submit"]')
        ?.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toastError).not.toHaveBeenCalled();
    const composer = container!.querySelector(
      '[data-testid="prompt-composer"]',
    );
    expect(composer?.getAttribute("data-initial-text")).toBe("");
  });
});

describe("PromptPopover attachment editing", () => {
  it("keeps typing available during eager upload and waits before submitting", async () => {
    let resolveUpload!: (files: Array<{ path: string }>) => void;
    const uploadPending = new Promise<Array<{ path: string }>>((resolve) => {
      resolveUpload = resolve;
    });
    mockEagerUpload.implementation = () => uploadPending;
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await renderPopover({ onSubmit });

    const fileInput = container!.querySelector<HTMLInputElement>(
      '[data-testid="prompt-file-input"]',
    );
    const file = new File(["image"], "hero.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    const editor = container!.querySelector<HTMLTextAreaElement>(
      '[data-testid="prompt-editor"]',
    );
    expect(editor?.disabled).toBe(false);
    await act(async () => {
      if (!editor) throw new Error("prompt editor was not rendered");
      editor.value = "keep typing";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(editor?.value).toBe("keep typing");

    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="composer-submit"]')
        ?.click();
      await Promise.resolve();
    });
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => {
      resolveUpload([{ path: "/uploads/hero.png" }]);
      await uploadPending;
    });
    expect(onSubmit).toHaveBeenCalledWith(
      "keep typing",
      [{ path: "/uploads/hero.png" }],
      expect.anything(),
    );
  });
});

describe("PromptPopover skip affordance", () => {
  it("does not expose a generic Skip prompt action when no semantic action is named", async () => {
    await renderPopover({ onSkip: vi.fn() });
    const skipButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent === "promptDialog.skipPrompt",
    );
    expect(skipButton).toBeUndefined();
  });

  it("uses an explicit skipLabel over the localized default", async () => {
    await renderPopover({ onSkip: vi.fn(), skipLabel: "Not now" });
    const skipButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Not now",
    );
    expect(skipButton).toBeTruthy();
  });

  it("fires once and closes once after an async skip succeeds", async () => {
    let resolveSkip: (() => void) | undefined;
    const onSkip = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSkip = resolve;
        }),
    );
    const onOpenChange = vi.fn();
    await renderPopover({ onSkip, onOpenChange, skipLabel: "Use template" });
    const skipButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Use template",
    );

    await act(async () => {
      skipButton?.click();
      skipButton?.click();
      await Promise.resolve();
    });

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      resolveSkip?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open and allows retry when an async skip fails", async () => {
    const onSkip = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("create failed"))
      .mockResolvedValueOnce(undefined);
    const onOpenChange = vi.fn();
    await renderPopover({ onSkip, onOpenChange, skipLabel: "Use template" });
    const findSkipButton = () =>
      Array.from(container!.querySelectorAll("button")).find(
        (btn) => btn.textContent === "Use template",
      );

    await act(async () => {
      findSkipButton()?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(findSkipButton()?.disabled).toBe(false);
    expect(
      container!.querySelector('[data-testid="prompt-composer"]'),
    ).toBeTruthy();

    await act(async () => {
      findSkipButton()?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSkip).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not close after a successful skip that already navigated", async () => {
    const onSkip = vi.fn().mockResolvedValue(false);
    const onOpenChange = vi.fn();
    await renderPopover({ onSkip, onOpenChange, skipLabel: "Use template" });
    const skipButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Use template",
    );

    await act(async () => {
      skipButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("PromptPopover template picker", () => {
  const templates = [
    {
      id: "built-in-template",
      title: "Built-in launch",
      isBuiltIn: true,
      previewHtml: "<main>Built in</main>",
    },
    {
      id: "saved-template",
      title: "Saved campaign",
      isBuiltIn: false,
      previewHtml: "<main>Saved</main>",
    },
  ];

  it("shows the selected preview, name, badge, and grouped saved-first options", async () => {
    await renderPopover({
      templateOptions: templates,
      selectedTemplateId: "built-in-template",
      onTemplateChange: vi.fn(),
    });

    const trigger = container!.querySelector("[data-template-picker-trigger]");
    expect(trigger?.textContent).toContain(
      "promptDialog.template · Built-in launch",
    );
    expect(trigger?.textContent).toContain("promptDialog.builtIn");
    expect(
      trigger?.querySelector('[data-template-preview="Built-in launch"]'),
    ).toBeTruthy();

    const text = container!.textContent ?? "";
    expect(text.indexOf("promptDialog.blank")).toBeLessThan(
      text.indexOf("promptDialog.yourTemplates"),
    );
    expect(text.indexOf("promptDialog.yourTemplates")).toBeLessThan(
      text.indexOf("Saved campaign"),
    );
    expect(text.indexOf("Saved campaign")).toBeLessThan(
      text.indexOf("promptDialog.builtInTemplates"),
    );
    expect(text.indexOf("promptDialog.builtInTemplates")).toBeLessThan(
      text.lastIndexOf("Built-in launch"),
    );
  });

  it("selects both saved and built-in templates through the shared control", async () => {
    const onTemplateChange = vi.fn();
    await renderPopover({
      templateOptions: templates,
      selectedTemplateId: null,
      onTemplateChange,
    });

    await act(async () => {
      container!
        .querySelector<HTMLElement>('[data-template-option="saved-template"]')
        ?.click();
    });
    expect(onTemplateChange).toHaveBeenCalledWith("saved-template");

    await act(async () => {
      container!
        .querySelector<HTMLElement>(
          '[data-template-option="built-in-template"]',
        )
        ?.click();
    });
    expect(onTemplateChange).toHaveBeenCalledWith("built-in-template");
  });
});
