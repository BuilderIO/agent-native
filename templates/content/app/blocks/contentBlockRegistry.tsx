import {
  BlockRegistry,
  // The standard library (checklist, table, code-tabs, html, tabs + the eight
  // dev-doc blocks) is registered once via `registerLibraryBlocks` — the SAME
  // shared list plan registers. Content has no app-specific blocks beyond the
  // library, so it only re-types the table block (see below).
  registerLibraryBlocks,
  type BlockRenderContext,
} from "@agent-native/core/blocks";
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
export function createContentBlockRenderContext(): BlockRenderContext {
  return {
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
    renderEditSurface: ({ title, trigger, children }) => (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          data-plan-interactive
          className="an-block-edit-popover flex max-h-[70vh] w-96 flex-col gap-3 overflow-auto"
        >
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {children}
        </PopoverContent>
      </Popover>
    ),
  };
}
