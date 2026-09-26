import {
  BlockView,
  BlockRegistry,
  registerLibraryBlocks,
  type BlockRenderContext,
  type NestedBlock,
} from "@agent-native/core/blocks";
import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useEffect, useRef, useState } from "react";

import { uploadImageFile } from "@/components/editor/image-upload";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { builderDocsBlocks } from "./BuilderDocsBlocks";
import {
  ContentBlockMarkdown,
  ContentBlockMarkdownEditor,
} from "./ContentBlockMarkdown";
import { inlineDatabaseBlock } from "./InlineDatabaseBlock";
import { sourceComponentBlock } from "./SourceComponentBlock";

export const contentBlockRegistry = new BlockRegistry();

registerLibraryBlocks(contentBlockRegistry, {
  overrides: {
    table: { type: "table-block" },
    code: { empty: () => ({ code: "" }) },
    "code-tabs": {
      empty: () => ({
        tabs: [{ id: "tab-1", label: "file.ts", code: "" }],
      }),
    },
  },
});
for (const block of builderDocsBlocks) {
  contentBlockRegistry.register(block);
}
contentBlockRegistry.register(sourceComponentBlock);
contentBlockRegistry.register(inlineDatabaseBlock);

type ContentBlockRenderContext = BlockRenderContext & {
  documentId?: string | null;
  canEdit?: boolean;
};

export function createContentBlockRenderContext(options?: {
  documentId?: string | null;
  canEdit?: boolean;
}): BlockRenderContext {
  const ctx: ContentBlockRenderContext = {
    dialect: "nfm",
    documentId: options?.documentId,
    canEdit: options?.canEdit,
    renderMarkdown: (markdown) => <ContentBlockMarkdown markdown={markdown} />,
    renderMarkdownEditor: ({ value, onChange, editable }) => (
      <ContentBlockMarkdownEditor
        value={value}
        onChange={onChange}
        editable={editable}
      />
    ),
    uploadFile: async (file: File) => {
      const url = await uploadImageFile(file);
      return { url };
    },
    renderEditSurface: ({
      title,
      trigger,
      children,
      open,
      onOpenChange,
      variant,
      blockId,
      blockType,
      blockTitle,
      blockSummary,
      blockData,
    }) => {
      const compactMenu = variant === "menu";

      return (
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            data-plan-interactive
            className={cn(
              "flex max-h-[70vh] overflow-auto",
              compactMenu
                ? "an-block-menu-popover w-80 flex-col gap-1 rounded-xl p-1"
                : "an-block-edit-popover w-96 flex-col gap-3",
            )}
          >
            {compactMenu ? (
              <>
                {children}
                {blockId && blockType ? (
                  <div className="mt-1 border-t border-border px-1.5 pt-2">
                    <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                      Ask AI to edit
                    </div>
                    <ContentAiBlockAction
                      label={title}
                      blockId={blockId}
                      blockType={blockType}
                      blockTitle={blockTitle}
                      blockSummary={blockSummary}
                      blockData={blockData}
                      documentId={options?.documentId}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {title}
                  </div>
                </div>
                {children}
              </>
            )}
          </PopoverContent>
        </Popover>
      );
    },
  };
  ctx.renderBlock = ({ block, editing = false, onChange }) =>
    renderNestedContentBlock(block, ctx, editing, onChange);
  return ctx;
}

function ContentAiBlockAction({
  label,
  blockId,
  blockType,
  blockTitle,
  blockSummary,
  blockData,
  documentId,
}: {
  label: string;
  blockId: string;
  blockType: string;
  blockTitle?: string;
  blockSummary?: string;
  blockData: unknown;
  documentId?: string | null;
}) {
  const submitPrompt = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    sendToAgentChat({
      type: "content",
      submit: true,
      openSidebar: true,
      message: trimmed,
      context: [
        "The user is asking the agent to edit a focused structured block from the Content document editor popover.",
        documentId ? `Document id: ${documentId}` : null,
        `Document block id: ${blockId}`,
        `Document block type: ${blockType}`,
        blockTitle ? `Block title: ${blockTitle}` : null,
        blockSummary ? `Block summary: ${blockSummary}` : null,
        "",
        "Current block data:",
        fencedBlockData(blockData),
        "",
        "Patch the document's inline NFM/MDX block with this exact id. Use the Content app document editing actions, and patch only this block unless the user's instruction explicitly asks for a broader document change. Preserve existing block fields that the user did not ask to change.",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  };

  return (
    <InlinePromptField
      placeholder="Describe a change…"
      ariaLabel={`Describe a change to ${label.toLowerCase()}`}
      onSubmit={submitPrompt}
    />
  );
}

function InlinePromptField({
  placeholder,
  ariaLabel,
  onSubmit,
  disabled,
}: {
  placeholder: string;
  ariaLabel?: string;
  onSubmit: (text: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
    if (ref.current) ref.current.style.height = "";
    ref.current?.blur();
  };

  return (
    <div
      data-plan-interactive
      className={cn(
        "relative inline-flex w-[290px] shrink-0 items-start overflow-hidden rounded-2xl border border-input bg-background shadow-sm transition-colors focus-within:border-ring",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className="max-h-[220px] w-full cursor-text resize-none bg-transparent py-1.5 pl-3 pr-8 text-xs leading-snug text-foreground outline-none placeholder:text-muted-foreground"
      />
      <kbd
        aria-hidden
        className="pointer-events-none absolute right-1.5 top-1.5 rounded border border-border bg-background/80 px-1 font-sans text-[10px] leading-tight text-muted-foreground opacity-60"
      >
        ⏎
      </kbd>
    </div>
  );
}

function fencedBlockData(value: unknown): string {
  try {
    return ["Block data:", "```json", JSON.stringify(value, null, 2), "```"]
      .filter(Boolean)
      .join("\n");
  } catch {
    return ["Block data:", "```text", String(value), "```"].join("\n");
  }
}

function renderNestedContentBlock(
  block: NestedBlock,
  ctx: BlockRenderContext,
  editing: boolean,
  onChange?: (next: NestedBlock) => void,
) {
  if (block.type === "rich-text") {
    const currentData =
      block.data && typeof block.data === "object"
        ? (block.data as Record<string, unknown>)
        : {};
    const markdown =
      typeof (block.data as { markdown?: unknown } | null)?.markdown ===
      "string"
        ? ((block.data as { markdown: string }).markdown ?? "")
        : "";
    return editing ? (
      <ContentBlockMarkdownEditor
        value={markdown}
        editable
        onChange={(nextMarkdown) =>
          onChange?.({
            ...block,
            data: { ...currentData, markdown: nextMarkdown },
          })
        }
      />
    ) : (
      <ContentBlockMarkdown markdown={markdown} />
    );
  }

  const spec = contentBlockRegistry.get(block.type);
  if (!spec) return null;
  return (
    <BlockView
      spec={spec}
      block={{
        id: block.id,
        title: block.title,
        summary: block.summary,
        data: block.data,
      }}
      editing={editing}
      editable
      onChange={
        onChange
          ? (nextData) => onChange({ ...block, data: nextData })
          : undefined
      }
      ctx={ctx}
    />
  );
}
