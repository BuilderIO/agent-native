import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconCode,
  IconEdit,
  IconPhoto,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  uploadEditorImage,
  type RichMarkdownCollabUser,
} from "@agent-native/core/client";
import {
  BlockView,
  SchemaBlockEditor,
  blockEditSurface,
  useOptionalBlockRegistry,
} from "@agent-native/core/blocks";
import { cn } from "@/lib/utils";
import { imageDataSchema, type PlanBlock } from "@shared/plan-content";
import { Wireframe } from "./wireframe/Wireframe";
import { PlanMarkdownReader } from "./PlanMarkdownReader";
import { PlanImageViewer } from "./PlanImageViewer";

const LazyPlanMarkdownEditor = lazy(() =>
  import("./PlanMarkdownEditor").then((mod) => ({
    default: mod.PlanMarkdownEditor,
  })),
);

/**
 * Marker prefix embedded in salvaged "unknown-block" callout bodies by the
 * server-side per-block salvage path in parsePlanContent. The renderer detects
 * this prefix and shows a "Unsupported block" placeholder card rather than a
 * generic callout.
 *
 * Format: `__unknown_block__:<originalType>\n<errorSummary>`
 */
const UNKNOWN_BLOCK_MARKER = "​__unknown_block__:";

/** React error boundary that catches render errors from a single block. */
class BlockErrorBoundary extends Component<
  { blockId: string; blockType: string; children: ReactNode },
  { error: Error | null }
> {
  constructor(props: {
    blockId: string;
    blockType: string;
    children: ReactNode;
  }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error(
      `[PlanBlockView] render error in block ${this.props.blockId} (${this.props.blockType}):`,
      error,
    );
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <UnknownBlockPlaceholder
        blockId={this.props.blockId}
        originalType={this.props.blockType}
        errorSummary={this.state.error.message}
      />
    );
  }
}

/** Muted "Unsupported block" card for unknown/salvaged/errored blocks. */
function UnknownBlockPlaceholder({
  blockId,
  originalType,
  errorSummary,
}: {
  blockId: string;
  originalType: string;
  errorSummary: string;
}) {
  return (
    <section
      className="plan-block"
      data-block-id={blockId}
      data-unknown-block-type={originalType}
    >
      <div className="flex items-start gap-2 rounded-lg border border-plan-line bg-plan-block/40 px-3 py-2.5 text-plan-muted">
        <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <span className="min-w-0 text-sm">
          <span className="font-medium text-plan-text">
            Unsupported block: {originalType}
          </span>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs opacity-60 hover:opacity-80">
              Show details
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs opacity-70">
              {errorSummary}
            </pre>
          </details>
        </span>
      </div>
    </section>
  );
}

type PlanBlockViewProps = {
  block: PlanBlock;
  onChange?: (block: PlanBlock) => Promise<void> | void;
  onRichTextChange?: (
    blockId: string,
    markdown: string,
  ) => Promise<void> | void;
  onVisualQuestionsSubmit?: (summary: string) => void;
  compactVisuals?: boolean;
  contentUpdatedAt?: string | null;
  editingDisabled?: boolean;
  planId?: string | null;
  collabUser?: RichMarkdownCollabUser | null;
};

/**
 * Renders the document flow: dispatches a single plan block to its block
 * component. `compactVisuals` tightens embedded wireframes/diagrams in dense
 * contexts (e.g. tab panes). Wrapped in a per-block error boundary so one
 * crashing renderer shows an inline error card instead of blanking the document.
 */
export function PlanBlockView(props: PlanBlockViewProps) {
  return (
    <BlockErrorBoundary blockId={props.block.id} blockType={props.block.type}>
      <PlanBlockViewInner {...props} />
    </BlockErrorBoundary>
  );
}

function PlanBlockViewInner({
  block,
  onChange,
  onRichTextChange,
  onVisualQuestionsSubmit,
  compactVisuals,
  contentUpdatedAt,
  editingDisabled = false,
  planId,
  collabUser,
}: PlanBlockViewProps) {
  // Registry-first dispatch. If the block type is registered, render through the
  // block registry (`BlockView` → spec `Read`, or in edit mode the spec `Edit`
  // or the schema-driven auto-editor). Unregistered types fall through to the
  // legacy branches below unchanged, so existing blocks keep working. The spec's
  // `Read` owns its own block container; the editor path is wrapped in a titled
  // `plan-block` section here so editing matches the document chrome.
  const blockRegistry = useOptionalBlockRegistry();
  const spec = blockRegistry?.registry.get(block.type);
  if (blockRegistry && spec) {
    const editable = block.editable !== false && !!onChange;
    const editing = editable && !editingDisabled;
    const view = (
      <BlockView
        spec={spec}
        block={{
          id: block.id,
          title: block.title,
          summary: block.summary,
          data: (block as { data: unknown }).data,
        }}
        editing={editing}
        editable={editable}
        onChange={(nextData) =>
          onChange?.({
            ...block,
            data: nextData,
          } as PlanBlock)
        }
        ctx={blockRegistry.ctx}
        compactVisuals={compactVisuals}
      />
    );
    // In INLINE / CONTAINER edit mode the auto-editor / custom Edit often renders
    // bare fields — wrap them in the standard titled block section. In read mode
    // (and in PANEL edit mode, where `BlockView` renders the spec's own `Read`
    // plus a corner edit button) the spec already provides its own section, so
    // render it directly to avoid double-nesting.
    const surface = blockEditSurface(spec);
    const wrapInline =
      editing && spec.placement.includes("block") && surface !== "panel";
    return wrapInline ? (
      <section className="plan-block" data-block-id={block.id}>
        {block.title && <div className="plan-block-label">{block.title}</div>}
        {view}
        {block.summary && (
          <p className="mt-5 text-plan-muted">{block.summary}</p>
        )}
      </section>
    ) : (
      view
    );
  }

  if (block.type === "rich-text") {
    return (
      <RichTextBlock
        block={block}
        onChange={onChange}
        onRichTextChange={onRichTextChange}
        contentUpdatedAt={contentUpdatedAt}
        editingDisabled={editingDisabled}
        planId={planId}
        collabUser={collabUser}
      />
    );
  }
  if (block.type === "callout") {
    // Detect the server-side per-block salvage marker. The marker starts with a
    // zero-width-space followed by `__unknown_block__:<type>` to avoid collision
    // with real callout content (real callouts never start with a ZWSP).
    if (block.data.body.startsWith(UNKNOWN_BLOCK_MARKER)) {
      const rest = block.data.body.slice(UNKNOWN_BLOCK_MARKER.length);
      const newline = rest.indexOf("\n");
      const originalType = newline >= 0 ? rest.slice(0, newline) : rest;
      const errorSummary = newline >= 0 ? rest.slice(newline + 1) : "";
      return (
        <UnknownBlockPlaceholder
          blockId={block.id}
          originalType={originalType}
          errorSummary={errorSummary}
        />
      );
    }
    return (
      <section className="plan-block plan-callout" data-block-id={block.id}>
        {block.title && <div className="plan-block-label">{block.title}</div>}
        <PlanMarkdownReader markdown={block.data.body} />
      </section>
    );
  }
  if (block.type === "checklist") {
    return (
      <section className="plan-block" data-block-id={block.id}>
        {block.title && <div className="plan-block-label">{block.title}</div>}
        <div className="grid gap-3">
          {block.data.items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-plan-interactive
              className="flex items-start gap-3 text-left text-plan-muted"
              onClick={() =>
                onChange?.({
                  ...block,
                  data: {
                    items: block.data.items.map((current) =>
                      current.id === item.id
                        ? { ...current, checked: !current.checked }
                        : current,
                    ),
                  },
                })
              }
            >
              <span
                className={cn(
                  "mt-1 flex size-5 items-center justify-center rounded border",
                  item.checked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-plan-line",
                )}
              >
                {item.checked && <IconCheck className="size-3.5" />}
              </span>
              <span>
                <span className="block text-plan-text">{item.label}</span>
                {item.note && (
                  <span className="block text-sm">{item.note}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }
  if (block.type === "table") {
    return (
      <section className="plan-block overflow-x-auto" data-block-id={block.id}>
        {block.title && <div className="plan-block-label">{block.title}</div>}
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-plan-line text-sm text-plan-muted">
              {block.data.columns.map((column) => (
                <th key={column} className="py-3 pr-4 font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.data.rows.map((row, index) => (
              <tr key={index} className="border-b border-plan-line">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="py-4 pr-4 text-plan-muted">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }
  if (block.type === "code-tabs") {
    // Display-time migration: render code-tabs as a tabs block with inline code
    // children so old stored plans get the richer tabs UX. Storage stays intact
    // (no write-back); the block re-converts on every render.
    const migratedTabs: Extract<PlanBlock, { type: "tabs" }> = {
      id: block.id,
      type: "tabs",
      title: block.title,
      summary: block.summary,
      data: {
        tabs: block.data.tabs.map((tab) => ({
          id: tab.id,
          label: tab.label,
          blocks: [
            {
              id: `${tab.id}_code`,
              type: "code" as const,
              data: {
                code: tab.code,
                ...(tab.language ? { language: tab.language } : {}),
                ...(tab.caption ? { caption: tab.caption } : {}),
              },
            },
          ],
        })),
      },
    };
    return (
      <TabsBlock
        block={migratedTabs}
        onRichTextChange={onRichTextChange}
        onVisualQuestionsSubmit={onVisualQuestionsSubmit}
        contentUpdatedAt={contentUpdatedAt}
        editingDisabled={editingDisabled}
        planId={planId}
        collabUser={collabUser}
      />
    );
  }
  if (block.type === "implementation-map") {
    // Display-time migration: render implementation-map as a file-tree block so
    // old plans use the modern file explorer rather than the deprecated layout.
    // The block-level `title` and each file's `note` and `snippet` carry over.
    // Storage stays intact.
    const migratedFileTree: Extract<PlanBlock, { type: "file-tree" }> = {
      id: block.id,
      type: "file-tree",
      title: block.title,
      summary: block.summary,
      data: {
        entries: block.data.files.map((file) => ({
          path: file.path,
          ...(file.note ? { note: file.note } : {}),
          ...(file.snippet ? { snippet: file.snippet } : {}),
          ...(file.language ? { language: file.language } : {}),
        })),
      },
    };
    return (
      <PlanBlockViewInner
        block={migratedFileTree}
        editingDisabled={editingDisabled}
        contentUpdatedAt={contentUpdatedAt}
        planId={planId}
        collabUser={collabUser}
      />
    );
  }
  if (block.type === "legacy-wireframe") {
    return (
      <section className="plan-block" data-block-id={block.id}>
        {block.title && <div className="plan-block-label">{block.title}</div>}
        <Wireframe data={block.data} compact={compactVisuals} />
        {block.summary && (
          <p className="mt-5 text-plan-muted">{block.summary}</p>
        )}
      </section>
    );
  }
  if (block.type === "image") {
    return (
      <ImageBlock
        block={block}
        onChange={onChange}
        editingDisabled={editingDisabled}
        planId={planId}
      />
    );
  }
  if (block.type === "tabs") {
    return (
      <TabsBlock
        block={block}
        onChange={onChange}
        onRichTextChange={onRichTextChange}
        onVisualQuestionsSubmit={onVisualQuestionsSubmit}
        contentUpdatedAt={contentUpdatedAt}
        editingDisabled={editingDisabled}
        planId={planId}
        collabUser={collabUser}
      />
    );
  }
  if (block.type === "custom-html") {
    return <CustomHtmlBlock block={block} onChange={onChange} />;
  }
  // Unregistered block type — show a muted placeholder so the rest of the
  // document stays visible instead of silently swallowing the block.
  return (
    <UnknownBlockPlaceholder
      blockId={block.id}
      originalType={(block as { type: string }).type}
      errorSummary="This block type is not supported by the current renderer."
    />
  );
}

function RichTextBlock({
  block,
  onChange,
  onRichTextChange,
  contentUpdatedAt,
  editingDisabled,
  planId,
  collabUser,
}: {
  block: Extract<PlanBlock, { type: "rich-text" }>;
  onChange?: (block: PlanBlock) => Promise<void> | void;
  onRichTextChange?: (
    blockId: string,
    markdown: string,
  ) => Promise<void> | void;
  contentUpdatedAt?: string | null;
  editingDisabled?: boolean;
  planId?: string | null;
  collabUser?: RichMarkdownCollabUser | null;
}) {
  const canUseInlineEditor = block.editable !== false && !!onChange;
  const editable = canUseInlineEditor && !editingDisabled;
  return (
    <section className="plan-block group" data-block-id={block.id}>
      {canUseInlineEditor && !editingDisabled ? (
        <Suspense
          fallback={
            <PlanMarkdownReader
              markdown={block.data.markdown}
              blockId={block.id}
            />
          }
        >
          <LazyPlanMarkdownEditor
            markdown={block.data.markdown}
            editable={editable}
            contentUpdatedAt={contentUpdatedAt}
            planId={planId}
            blockId={block.id}
            user={collabUser}
            onSave={(markdown) =>
              onRichTextChange
                ? onRichTextChange(block.id, markdown)
                : onChange?.({
                    ...block,
                    data: { ...block.data, markdown },
                  })
            }
          />
        </Suspense>
      ) : (
        // Read-only path (public / shared-reviewer / review mode / SSR): render
        // markdown without mounting Tiptap so comment clicks hit stable text.
        // Pass blockId so headings get stable anchor ids for deep-linking.
        <PlanMarkdownReader markdown={block.data.markdown} blockId={block.id} />
      )}
    </section>
  );
}

function CodeTabsBlock({
  block,
}: {
  block: Extract<PlanBlock, { type: "code-tabs" }>;
}) {
  const [activeId, setActiveId] = useState(block.data.tabs[0]?.id ?? "");
  const active =
    block.data.tabs.find((tab) => tab.id === activeId) ?? block.data.tabs[0];
  return (
    <section className="plan-block" data-block-id={block.id}>
      {block.title && <div className="plan-block-label">{block.title}</div>}
      <div className="grid overflow-hidden border-y border-plan-line md:grid-cols-[300px_minmax(0,1fr)]">
        <div className="border-plan-line md:border-r">
          {block.data.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-plan-interactive
              className={cn(
                "flex w-full items-start gap-3 border-b border-plan-line px-4 py-4 text-left",
                tab.id === active?.id
                  ? "bg-primary/10 text-plan-text dark:bg-primary/20"
                  : "text-plan-muted hover:bg-accent/30",
              )}
              onClick={() => setActiveId(tab.id)}
            >
              <IconCode className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate font-mono text-sm font-semibold">
                  {tab.label}
                </span>
                {tab.caption && (
                  <span className="mt-1 block text-xs leading-5">
                    {tab.caption}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
        <div className="min-w-0 p-5">
          {active && (
            <>
              <h3 className="text-2xl font-semibold tracking-tight">
                {active.label}
              </h3>
              {active.caption && (
                <p className="mt-2 text-plan-muted">{active.caption}</p>
              )}
              <CodeBlock code={active.code} language={active.language} />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function CodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  return (
    <div className={cn("plan-code-surface", className ?? "mt-5")}>
      <HighlightedCode code={code} language={language} />
    </div>
  );
}

function ImplementationMapBlock({
  block,
}: {
  block: Extract<PlanBlock, { type: "implementation-map" }>;
}) {
  // Track the active file by INDEX, not by path. A single file legitimately
  // appears in multiple rows (e.g. one workflow file touched three different
  // ways), so keying selection AND the React list key on `file.path` made every
  // row sharing a path highlight together and select as one. Index is unique.
  const [activeIndex, setActiveIndex] = useState(0);
  const active = block.data.files[activeIndex] ?? block.data.files[0];
  return (
    <section className="plan-block" data-block-id={block.id}>
      {block.title && <div className="plan-block-label">{block.title}</div>}
      <div className="grid overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="border-plan-line lg:border-r">
          {block.data.files.map((file, index) => (
            <button
              key={index}
              type="button"
              data-plan-interactive
              onClick={() => setActiveIndex(index)}
              className={cn(
                "grid w-full gap-1 border-b border-plan-line px-4 py-5 text-left",
                index === activeIndex
                  ? "bg-primary/10 text-plan-text dark:bg-primary/20"
                  : "text-plan-muted hover:bg-accent/30",
              )}
            >
              <span className="truncate font-mono text-sm font-semibold">
                {file.title || file.path.split("/").pop()}
              </span>
              <span className="truncate font-mono text-xs">{file.path}</span>
            </button>
          ))}
        </div>
        <div className="min-w-0 p-6">
          {active && (
            <>
              <p className="font-mono text-sm text-plan-muted">{active.path}</p>
              <h3 className="mt-3 text-xl font-semibold tracking-tight">
                {active.title || active.path.split("/").pop()}
              </h3>
              <p className="mt-4 max-w-3xl plan-doc-body text-plan-muted">
                {active.note}
              </p>
              {active.snippet && (
                <CodeBlock
                  code={active.snippet}
                  language={active.language}
                  className="mt-6"
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function TabsBlock({
  block,
  onChange,
  onRichTextChange,
  onVisualQuestionsSubmit,
  contentUpdatedAt,
  editingDisabled,
  planId,
  collabUser,
}: {
  block: Extract<PlanBlock, { type: "tabs" }>;
  onChange?: (block: PlanBlock) => Promise<void> | void;
  onRichTextChange?: (
    blockId: string,
    markdown: string,
  ) => Promise<void> | void;
  onVisualQuestionsSubmit?: (summary: string) => void;
  contentUpdatedAt?: string | null;
  editingDisabled?: boolean;
  planId?: string | null;
  collabUser?: RichMarkdownCollabUser | null;
}) {
  const [activeId, setActiveId] = useState(block.data.tabs[0]?.id ?? "");
  const active =
    block.data.tabs.find((tab) => tab.id === activeId) ?? block.data.tabs[0];
  const compactTabVisuals = /interaction|component|note/i.test(
    block.title ?? "",
  );
  const orientation =
    block.data.orientation === "vertical" ? "vertical" : "horizontal";
  const vertical = orientation === "vertical";
  const wideLayout = tabsBlockUsesWideLayout(block);
  return (
    <section
      className="plan-block"
      data-block-id={block.id}
      data-tabs-orientation={orientation}
      data-wide-layout-block={wideLayout ? "" : undefined}
    >
      {block.title && <div className="plan-block-label">{block.title}</div>}
      <div
        className={cn(
          vertical &&
            "grid min-w-0 gap-5 md:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)] md:items-start",
        )}
      >
        <div
          className={cn(
            vertical
              ? "mb-5 flex w-full min-w-0 max-w-full flex-nowrap gap-1 overflow-x-auto md:mb-0 md:max-h-[62vh] md:flex-col md:overflow-x-hidden md:overflow-y-auto md:pr-2"
              : "mb-8 inline-flex max-w-full gap-1 overflow-x-auto",
          )}
          role="tablist"
          aria-orientation={orientation}
          data-plan-interactive
        >
          {block.data.tabs.map((tab) => {
            const selected = tab.id === active?.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveId(tab.id)}
                className={cn(
                  "rounded-lg border border-transparent text-sm font-semibold transition-colors",
                  vertical
                    ? "min-w-0 max-w-72 shrink-0 px-3 py-2 text-left md:w-full md:max-w-none"
                    : "shrink-0 whitespace-nowrap px-4 py-2",
                  selected
                    ? "bg-primary/5 text-foreground dark:bg-primary/10"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                <span className={cn(vertical && "block min-w-0 truncate")}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
        {active && (
          <div className={cn(vertical && "min-w-0")}>
            {active.blocks.map((child) => (
              <PlanBlockView
                key={child.id}
                block={child}
                onRichTextChange={onRichTextChange}
                onVisualQuestionsSubmit={onVisualQuestionsSubmit}
                compactVisuals={compactTabVisuals}
                contentUpdatedAt={contentUpdatedAt}
                editingDisabled={editingDisabled}
                planId={planId}
                collabUser={collabUser}
                onChange={(nextChild) => {
                  onChange?.({
                    ...block,
                    data: {
                      ...block.data,
                      tabs: block.data.tabs.map((tab) =>
                        tab.id === active.id
                          ? {
                              ...tab,
                              blocks: updateBlocks(
                                tab.blocks,
                                child.id,
                                () => nextChild,
                              ),
                            }
                          : tab,
                      ),
                    },
                  });
                }}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function tabsBlockUsesWideLayout(
  block: Extract<PlanBlock, { type: "tabs" }>,
): boolean {
  return (
    block.data.orientation === "vertical" ||
    block.data.tabs.some((tab) => blocksContainDiffLike(tab.blocks))
  );
}

function blocksContainDiffLike(blocks: PlanBlock[]): boolean {
  return blocks.some(blockContainsDiffLike);
}

function blockContainsDiffLike(block: PlanBlock): boolean {
  if (block.type === "diff" || block.type === "annotated-code") return true;
  if (block.type === "tabs") {
    return block.data.tabs.some((tab) => blocksContainDiffLike(tab.blocks));
  }
  if (block.type === "columns") {
    return block.data.columns.some((column) =>
      blocksContainDiffLike(column.blocks),
    );
  }
  return false;
}

function CustomHtmlBlock({
  block,
  onChange,
}: {
  block: Extract<PlanBlock, { type: "custom-html" }>;
  onChange?: (block: PlanBlock) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [html, setHtml] = useState(block.data.html);
  const [css, setCss] = useState(block.data.css ?? "");

  // Resync drafts from block.data when not actively editing so agent/poll
  // updates are reflected without clobbering in-progress manual edits.
  useEffect(() => {
    if (!editing) {
      setHtml(block.data.html);
      setCss(block.data.css ?? "");
    }
  }, [editing, block.data.html, block.data.css]);

  // Re-seed from the current block data each time edit mode is ENTERED so
  // stale mount-time state can never clobber a newer agent edit on save.
  const openEditing = () => {
    setHtml(block.data.html);
    setCss(block.data.css ?? "");
    setEditing(true);
  };

  // Use prefers-color-scheme so the iframe ink matches the host theme even
  // though the iframe document is isolated and can't inherit CSS variables.
  const srcDoc = `<!doctype html><html><head><style>body{margin:0;min-height:100%;font-family:Inter,system-ui,sans-serif;color:#1f1f1d;background:transparent;}*{box-sizing:border-box}@media(prefers-color-scheme:dark){body{color:#e8e8e6}}${block.data.css ?? ""}</style></head><body>${block.data.html}</body></html>`;
  return (
    <section className="plan-block group" data-block-id={block.id}>
      <div className="flex items-start justify-between gap-4">
        {block.title ? (
          <div className="plan-block-label">{block.title}</div>
        ) : (
          <span />
        )}
        {onChange && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-plan-interactive
            aria-label={editing ? "Cancel editing source" : "Edit source"}
            className="size-8 text-plan-muted hover:bg-transparent hover:text-plan-text"
            onClick={() => (editing ? setEditing(false) : openEditing())}
          >
            {editing ? (
              <IconX className="size-4" />
            ) : (
              <IconEdit className="size-4" />
            )}
          </Button>
        )}
      </div>
      {editing ? (
        <div className="mt-4 grid gap-3" data-plan-interactive>
          <Textarea
            value={html}
            onChange={(event) => setHtml(event.target.value)}
            className="min-h-48 font-mono text-sm"
            placeholder="HTML fragment"
          />
          <Textarea
            value={css}
            onChange={(event) => setCss(event.target.value)}
            className="min-h-32 font-mono text-sm"
            placeholder="Optional CSS"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                onChange?.({
                  ...block,
                  data: { ...block.data, html, css: css || undefined },
                });
                setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          <iframe
            title={block.title || "Custom HTML block"}
            srcDoc={srcDoc}
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            className="mt-4 h-[360px] w-full rounded-xl border border-plan-line bg-plan-block"
          />
          {block.data.caption && (
            <p className="mt-3 text-sm text-plan-muted">{block.data.caption}</p>
          )}
        </>
      )}
    </section>
  );
}

/* ── Shiki syntax highlighting (lazy-loaded, light/dark themes) ─────────── */
type ShikiHighlighter = {
  codeToHtml: (
    code: string,
    options: {
      lang: string;
      themes: { light: string; dark: string };
      defaultColor?: false | "light" | "dark";
    },
  ) => string | Promise<string>;
  getLoadedLanguages: () => string[];
};

let highlighterLoader: Promise<ShikiHighlighter> | null = null;
function loadHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterLoader) {
    highlighterLoader = (async () => {
      const [{ createHighlighterCore }, { createOnigurumaEngine }] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/oniguruma"),
        ]);
      return createHighlighterCore({
        themes: [
          import("shiki/themes/github-light-default.mjs"),
          import("shiki/themes/github-dark-default.mjs"),
        ],
        langs: [
          import("shiki/langs/javascript.mjs"),
          import("shiki/langs/typescript.mjs"),
          import("shiki/langs/jsx.mjs"),
          import("shiki/langs/tsx.mjs"),
          import("shiki/langs/json.mjs"),
          import("shiki/langs/css.mjs"),
          import("shiki/langs/html.mjs"),
          import("shiki/langs/markdown.mjs"),
          import("shiki/langs/bash.mjs"),
          import("shiki/langs/shellscript.mjs"),
          import("shiki/langs/python.mjs"),
          import("shiki/langs/yaml.mjs"),
          import("shiki/langs/sql.mjs"),
        ],
        engine: createOnigurumaEngine(import("shiki/wasm")),
      }) as unknown as Promise<ShikiHighlighter>;
    })().catch((error) => {
      highlighterLoader = null;
      throw error;
    });
  }
  return highlighterLoader;
}

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  yml: "yaml",
  md: "markdown",
};

function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadHighlighter()
      .then((highlighter) => {
        const requested = (language || "text").toLowerCase();
        const resolved = LANG_ALIASES[requested] ?? requested;
        const loaded = highlighter.getLoadedLanguages();
        const lang = loaded.includes(resolved) ? resolved : "text";
        return highlighter.codeToHtml(code, {
          lang,
          themes: {
            light: "github-light-default",
            dark: "github-dark-default",
          },
          defaultColor: false,
        });
      })
      .then((out) => {
        if (!cancelled) setHtml(out as string);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (html) {
    // Shiki output is generated from plain text by the highlighter itself —
    // it is NOT agent-authored HTML, so this is safe (mirrors core chat).
    return (
      <div className="plan-shiki" dangerouslySetInnerHTML={{ __html: html }} />
    );
  }
  return (
    <pre>
      <code className={language ? `language-${language}` : undefined}>
        {code}
      </code>
    </pre>
  );
}

/* ── Image block ───────────────────────────────────────────────────────── */

type PlanImageData = Extract<PlanBlock, { type: "image" }>["data"];

function ImageBlock({
  block,
  onChange,
  editingDisabled = false,
  planId,
}: {
  block: Extract<PlanBlock, { type: "image" }>;
  onChange?: (block: PlanBlock) => Promise<void> | void;
  editingDisabled?: boolean;
  planId?: string | null;
}) {
  const blockRegistry = useOptionalBlockRegistry();
  const ctx = blockRegistry?.ctx;
  const src = block.data.url ?? imageSrcForAsset(block.data.assetId);
  const editable = !!onChange && !editingDisabled;
  const [editOpen, setEditOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Opening the edit popover from the ⋯ dropdown item hits a Radix race: closing
  // the dropdown restores focus to its trigger, which the just-opened popover
  // reads as a focus-outside and instantly dismisses. Defer the open one
  // macrotask (so the dropdown closes first) AND ignore any close that arrives in
  // the first moments after opening (the focus-restore bounce).
  const editOpenedAtRef = useRef(0);
  const openEdit = () => {
    window.setTimeout(() => {
      editOpenedAtRef.current = Date.now();
      setEditOpen(true);
    }, 0);
  };
  const handleEditOpenChange = (open: boolean) => {
    if (!open && Date.now() - editOpenedAtRef.current < 350) return;
    setEditOpen(open);
  };

  // Auto-focus the "Describe a change…" prompt once the edit popover mounts. The
  // popover portals out and the deferred/guarded open can race Radix's own
  // auto-focus, so focus it explicitly (a few retries to win the open animation).
  useEffect(() => {
    if (!editOpen) return;
    const focusPrompt = () =>
      document
        .querySelector<HTMLTextAreaElement>(
          ".an-block-edit-popover textarea[placeholder^='Describe a change']",
        )
        ?.focus();
    const timers = [40, 140, 280].map((ms) =>
      window.setTimeout(focusPrompt, ms),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [editOpen]);

  const commitData = (data: PlanImageData) => onChange?.({ ...block, data });

  async function handleReplaceFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const toastId = toast.loading("Replacing image…");
    try {
      const { src: nextSrc, alt: nextAlt } = await uploadEditorImage(file);
      commitData({
        ...block.data,
        url: nextSrc,
        alt: block.data.alt || nextAlt || "image",
      });
      toast.success("Image replaced.", { id: toastId });
    } catch (error) {
      console.error("Image replace failed:", error);
      toast.error("Could not replace the image.", { id: toastId });
    }
  }

  // Reuse the EXACT edit surface registry blocks use — the shared
  // `renderEditSurface` popover (the schema form + the auto-focusing top-right
  // "Edit with AI" prompt) — pulled from the block-render context. No bespoke
  // edit UI and no `planBlocks` import (so no module cycle). It's opened from the
  // image's own ⋯ overlay, so the block keeps a single hover overlay with no
  // separate corner pencil.
  const editSurface =
    editable && ctx?.renderEditSurface
      ? ctx.renderEditSurface({
          title: "Image",
          open: editOpen,
          onOpenChange: handleEditOpenChange,
          blockId: block.id,
          blockType: "image",
          blockTitle: block.title,
          blockSummary: block.summary,
          blockData: block.data,
          trigger: (
            <span
              aria-hidden
              className="pointer-events-none absolute right-2 top-2 block size-0"
            />
          ),
          children: (
            <SchemaBlockEditor
              data={block.data}
              schema={imageDataSchema}
              onChange={(next) => commitData(next as PlanImageData)}
              editable
              blockId={block.id}
              ctx={ctx}
            />
          ),
        })
      : null;

  return (
    <section className="plan-block relative" data-block-id={block.id}>
      {block.title && <div className="plan-block-label">{block.title}</div>}
      {editable && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={handleReplaceFile}
        />
      )}
      {src ? (
        <PlanImageViewer
          src={src}
          alt={block.data.alt}
          loading="lazy"
          block
          className="mt-4"
          imgClassName={cn(
            "max-h-[640px] w-full rounded-lg",
            block.data.fit === "cover" ? "object-cover" : "object-contain",
          )}
          onEdit={editable ? openEdit : undefined}
          onReplace={editable ? () => fileInputRef.current?.click() : undefined}
        />
      ) : (
        <div className="mt-4 flex h-48 items-center justify-center rounded-lg border border-dashed border-plan-line bg-plan-block text-plan-muted">
          <IconPhoto className="mr-2 size-5" />
          {block.data.alt}
        </div>
      )}
      {block.data.caption && (
        <p className="mt-3 text-sm text-plan-muted">{block.data.caption}</p>
      )}
      {editSurface}
    </section>
  );
}

function imageSrcForAsset(assetId?: string): string | undefined {
  if (!assetId) return undefined;
  // Encode the asset ID into the plan-asset serving route.
  // The filename segment is omitted here since the route handler uses only the
  // asset ID for lookup; a trailing slash is added for compatibility.
  return `/_agent-native/plan-asset/${encodeURIComponent(assetId)}/image`;
}

function updateBlocks(
  blocks: PlanBlock[],
  id: string,
  updater: (block: PlanBlock) => PlanBlock,
): PlanBlock[] {
  return blocks.map((block) => {
    if (block.id === id) return updater(block);
    if (block.type !== "tabs") return block;
    return {
      ...block,
      data: {
        ...block.data,
        tabs: block.data.tabs.map((tab) => ({
          ...tab,
          blocks: updateBlocks(tab.blocks, id, updater),
        })),
      },
    };
  });
}
