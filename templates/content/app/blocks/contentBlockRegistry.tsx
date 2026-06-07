import {
  BlockView,
  BlockRegistry,
  // The standard library (checklist, table, code-tabs, html, tabs + the eight
  // dev-doc blocks) is registered once via `registerLibraryBlocks` — the SAME
  // shared list plan registers. Content has no app-specific blocks beyond the
  // library, so it only re-types the table block (see below).
  registerLibraryBlocks,
  type BlockRenderContext,
  type NestedBlock,
} from "@agent-native/core/blocks";
import { PromptComposer, sendToAgentChat } from "@agent-native/core/client";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ContentBlockMarkdown,
  ContentBlockMarkdownEditor,
} from "./ContentBlockMarkdown";
import { uploadImageFile } from "@/components/editor/image-upload";

/**
 * Content's BROWSER block registry. Registers the same structured-block library
 * the server NFM registry (`shared/nfm-registry.ts`) registers, but WITH the real
 * React `Read`/`Edit` renderers. Both registries share the identical core
 * `schema` + `mdx` config per block, so what the editor renders and what the
 * inline NFM source serializes to can never drift.
 *
 * Block `type`s MUST match the server registry exactly: the NFM parser stamps a
 * `registryBlock` node's `blockType` from the server spec's `type`, and this
 * registry resolves the renderer back by that same `type`. The one place the two
 * diverge from the core default is the table — registered as `table-block` here
 * to match `nfm-registry.ts` (content already owns a Notion `table` node, so the
 * registry block can't reuse the bare `table` type). The core `tableBlock`'s
 * schema/mdx/Read/Edit are reused verbatim; only the discriminating `type`
 * changes.
 *
 * Mirrors `templates/plan/app/components/plan/planBlocks.tsx`.
 */
export const contentBlockRegistry = new BlockRegistry();

// Register the whole standard library in one shared call (the same list plan
// registers). Content's only override is the table `type` rename described above;
// every other block keeps its canonical core metadata, so adding a 14th library
// block in core lands in content automatically.
registerLibraryBlocks(contentBlockRegistry, {
  overrides: { table: { type: "table-block" } },
});

/**
 * Build the {@link BlockRenderContext} content's registry blocks render through.
 * Mirrors plan's `createPlanBlockRenderContext`, adapted to content:
 *  - `dialect: "nfm"` — content's prose dialect.
 *  - `renderMarkdown` / `renderMarkdownEditor` — block-internal prose (endpoint
 *    descriptions, file-tree notes, annotated-code notes) renders through a
 *    lightweight content markdown reader/editor rather than the document editor
 *    (block prose is small and read-mostly).
 *  - `renderEditSurface` — `editSurface: "panel"` blocks (the dev-doc blocks)
 *    open their editor in a shadcn Popover anchored to the corner edit button,
 *    non-modal so the rest of the document stays interactive.
 *  - `uploadFile` — routes block uploads through content's existing upload path.
 */
export function createContentBlockRenderContext(options?: {
  documentId?: string | null;
}): BlockRenderContext {
  const ctx: BlockRenderContext = {
    dialect: "nfm",
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
      blockId,
      blockType,
      blockTitle,
      blockSummary,
      blockData,
    }) => (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          data-plan-interactive
          className="an-block-edit-popover flex max-h-[70vh] w-96 flex-col gap-3 overflow-auto"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 truncate text-sm font-semibold text-foreground">
              {title}
            </div>
            {blockId && blockType ? (
              <ContentAiBlockAction
                label={title}
                blockId={blockId}
                blockType={blockType}
                blockTitle={blockTitle}
                blockSummary={blockSummary}
                blockData={blockData}
                documentId={options?.documentId}
              />
            ) : null}
          </div>
          {children}
        </PopoverContent>
      </Popover>
    ),
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
  const [open, setOpen] = useState(false);
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
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-plan-interactive
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-blue-400 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
        >
          Edit with AI
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="left"
        sideOffset={8}
        collisionPadding={12}
        className="z-[270] w-[calc(100vw-24px)] max-w-[420px] p-3"
        data-plan-interactive
      >
        <p className="px-1 pb-2 text-sm font-semibold text-foreground">
          Edit {label}
        </p>
        <PromptComposer
          autoFocus
          placeholder={`Tell the agent how to edit this ${label.toLowerCase()}...`}
          draftScope={`content:block:${blockId}`}
          attachmentsEnabled={false}
          plusMenuMode="hidden"
          onSubmit={submitPrompt}
        />
      </PopoverContent>
    </Popover>
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
