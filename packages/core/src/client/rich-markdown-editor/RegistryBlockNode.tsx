import {
  createContext,
  useEffect,
  useContext,
  useMemo,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { IconPencil } from "@tabler/icons-react";
import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  type EditorState,
} from "@tiptap/pm/state";
import {
  blockEditSurface,
  useOptionalBlockRegistry,
  type BlockDataChangeMeta,
  type BlockRenderContext,
} from "../blocks/index.js";
import { SchemaBlockEditor } from "../blocks/SchemaBlockEditor.js";

/* -------------------------------------------------------------------------- */
/* The generic registry-block side-map + Tiptap NodeView, lifted into core.    */
/*                                                                            */
/* This is the app-agnostic NodeView that renders registered block specs       */
/* inside a `SharedRichEditor` document. Hosts mount the node produced by      */
/* {@link createRegistryBlockNode} as an extra extension and wrap the editor   */
/* in a {@link RegistryBlockDataProvider}, sourcing the typed block `data`     */
/* from their own authoritative store (for example, PlanContent.blocks). The   */
/* node itself carries only lightweight identity attrs (type/id/title/summary) */
/* plus an optional `__raw` verbatim-MDX attr for byte-stable source           */
/* round-trips; the heavy typed `data` is threaded through the side-map        */
/* context, keeping the doc small and the block data the single source of      */
/* truth.                                                                     */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* C. Block-data side-map context                                             */
/* -------------------------------------------------------------------------- */

/** The minimal block shape the NodeView renders through `<BlockView>`. */
export interface RegistryBlockSideMapBlock {
  id: string;
  title?: string;
  summary?: string;
  data: unknown;
}

/**
 * The side-map an editor host supplies so the registry NodeView can resolve a
 * block's full typed `data` (and commit edits) by its stable id, without ever
 * storing that data in the ProseMirror doc.
 */
export interface RegistryBlockDataValue<
  TBlock extends RegistryBlockSideMapBlock = RegistryBlockSideMapBlock,
> {
  /** Resolve a block's full record (incl. `data`) by its stable id. */
  getBlock: (blockId: string) => TBlock | undefined;
  /** Commit a new `data` value for a block (edit-mode only). */
  onBlockDataChange: (
    blockId: string,
    nextData: unknown,
    meta?: BlockDataChangeMeta,
  ) => void;
  /** Whether the document (and thus its blocks) is editable. */
  editable: boolean;
  /**
   * When true, blocks whose type has no Notion (NFM) analog are badged so the
   * author knows they won't sync. The host decides which types are incompatible
   * via {@link isNotionIncompatibleType}; this flag just toggles the badge on.
   */
  notionSync?: boolean;
  /**
   * Decide whether a block type is Notion-incompatible (no NFM analog). Only
   * consulted when {@link notionSync} is true. Injected by the host so the
   * single registry-level allowlist (plan's `isNotionCompatibleBlockType`, or
   * content's registry-derived gate) drives the badge — core stays policy-free.
   */
  isNotionIncompatibleType?: (blockType: string) => boolean;
  /**
   * Render a block whose type is NOT in the registry through the host's own
   * dispatcher (plan: `PlanBlockView` for decision / legacy visual-questions /
   * image; omitted in hosts with no legacy types), so every block type renders
   * in the document instead of a bare fallback.
   */
  renderLegacyBlock?: (
    block: TBlock,
    options: { editing: boolean },
  ) => ReactNode;
}

const RegistryBlockDataContext =
  createContext<RegistryBlockDataValue<any> | null>(null);

export function RegistryBlockDataProvider<
  TBlock extends RegistryBlockSideMapBlock = RegistryBlockSideMapBlock,
>({
  value,
  children,
}: {
  value: RegistryBlockDataValue<TBlock>;
  children: ReactNode;
}) {
  return (
    <RegistryBlockDataContext.Provider value={value}>
      {children}
    </RegistryBlockDataContext.Provider>
  );
}

/** Read the registry block side-map. Returns `null` outside a provider. */
export function useRegistryBlockData<
  TBlock extends RegistryBlockSideMapBlock = RegistryBlockSideMapBlock,
>(): RegistryBlockDataValue<TBlock> | null {
  return useContext(
    RegistryBlockDataContext,
  ) as RegistryBlockDataValue<TBlock> | null;
}

function clickedInteractiveChild(target: HTMLElement) {
  if (target.closest("button,input,textarea,select,a,[role='textbox']")) {
    return true;
  }

  const blockNode = target.closest(".plan-block-node");
  const editable = target.closest("[contenteditable='true']");
  return !!blockNode && !!editable && blockNode.contains(editable);
}

/* -------------------------------------------------------------------------- */
/* B. RegistryBlockNodeView (React)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Renders one registry-block atom. The block is non-editable as far as
 * ProseMirror is concerned (`contentEditable={false}`); all interaction happens
 * inside the registry-driven `<BlockView>`. Read vs edit is toggled by
 * `props.selected` (the node is "selected" in the editor) AND the document being
 * editable. `data-plan-interactive` keeps existing host click-guards from
 * treating clicks inside the block as document clicks.
 */
export function RegistryBlockNodeView(props: NodeViewProps) {
  const blockType = String(props.node.attrs.blockType ?? "");
  const blockId = String(props.node.attrs.blockId ?? "");
  const [panelOpen, setPanelOpen] = useState(false);
  const [shellHovered, setShellHovered] = useState(false);

  const registryValue = useOptionalBlockRegistry();
  const sideMap = useRegistryBlockData();

  // Optimistic edit override. `onBlockDataChange` commits into the host's own
  // store (a ref the side-map context can't observe), so an edit does NOT
  // re-render this node — the new data only reaches the view on the next full
  // document reconcile, which lands after the autosave round-trip (seconds
  // later) and is skipped entirely when the host treats the save as its own
  // echo. That left quick toggles like the callout tone buttons visually frozen
  // until reload. Holding the just-edited data locally re-renders this one node
  // immediately, then releases once the authoritative block catches up to (or
  // moves past) the value the edit was based on.
  const [pendingEdit, setPendingEdit] = useState<{
    data: unknown;
    base: unknown;
  } | null>(null);
  const liveBlock = sideMap?.getBlock(blockId);
  const liveData = liveBlock?.data;
  useEffect(() => {
    if (pendingEdit && !Object.is(liveData, pendingEdit.base)) {
      setPendingEdit(null);
    }
  }, [liveData, pendingEdit]);
  const block =
    liveBlock && pendingEdit && Object.is(liveData, pendingEdit.base)
      ? { ...liveBlock, data: pendingEdit.data }
      : liveBlock;
  const commitBlockData = (nextData: unknown, meta?: BlockDataChangeMeta) => {
    setPendingEdit({ data: nextData, base: liveData });
    sideMap?.onBlockDataChange(blockId, nextData, meta);
  };
  const editable = sideMap?.editable ?? false;
  // In Notion-sync mode, flag blocks that have no Notion (NFM) analog so the
  // author sees what won't push. Prose blocks aren't registry-block nodes, so
  // this only ever covers structured blocks.
  const incompatibleWithNotion =
    (sideMap?.notionSync ?? false) &&
    (sideMap?.isNotionIncompatibleType?.(blockType) ?? false);

  // The block data isn't in the side-map yet (e.g. a freshly inserted node whose
  // store entry hasn't been seeded). Render a graceful placeholder.
  if (!block) {
    return (
      <NodeViewWrapper className="plan-block-node" data-block-id={blockId}>
        <div
          contentEditable={false}
          data-plan-interactive
          className="plan-block-node__placeholder rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground"
        >
          {blockType ? `Loading ${blockType} block…` : "Loading block…"}
        </div>
      </NodeViewWrapper>
    );
  }

  const spec = registryValue?.registry.get(blockType);
  const selectNode = (event: ReactMouseEvent<HTMLElement>) => {
    if (!editable) return;
    const target = event.target;
    if (target instanceof HTMLElement && clickedInteractiveChild(target))
      return;
    const pos = typeof props.getPos === "function" ? props.getPos() : null;
    if (typeof pos !== "number") return;
    try {
      event.preventDefault();
      event.stopPropagation();
      const { view } = props.editor;
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
      );
      view.focus();
    } catch {
      // Ignore stale positions during React/ProseMirror reconciliation.
    }
  };
  const updateShellHover = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    setShellHovered(
      target instanceof HTMLElement &&
        target.closest(".plan-block-node__shell") === event.currentTarget,
    );
  };

  // Choose how to render the block body:
  //  1. Registered spec → read view by default; direct-manipulation specs
  //     (`editSurface: "inline" | "container"`) render their editor in place,
  //     while artifact/config specs (`"panel"`) keep the read view plus a
  //     corner edit button.
  //  2. No spec, but the side-map provides `renderLegacyBlock` → delegate to the
  //     host's dispatcher (decision, legacy visual-questions, image, and any
  //     other type rendered by a bespoke component rather than the registry), so
  //     EVERY block type renders in the document exactly as it does in the
  //     per-block reader — never a bare title fallback.
  //  3. Neither → a small non-crashing fallback.
  let body: ReactNode;
  let editSurface: ReactNode = null;
  if (registryValue && spec) {
    const blockData = (block as { data: unknown }).data;
    const Read = spec.Read;
    const readNode = (
      <Read
        data={blockData}
        blockId={block.id}
        title={block.title}
        summary={block.summary}
        ctx={registryValue.ctx}
      />
    );
    body = readNode;
    const canEditBlock =
      editable &&
      spec.placement.includes("block") &&
      !!sideMap?.onBlockDataChange;
    if (canEditBlock) {
      const Edit = spec.Edit;
      const editorNode = Edit ? (
        <Edit
          data={blockData}
          onChange={commitBlockData}
          editable
          blockId={block.id}
          title={block.title}
          summary={block.summary}
          ctx={registryValue.ctx}
        />
      ) : (
        <SchemaBlockEditor
          data={blockData}
          onChange={(nextData) => commitBlockData(nextData)}
          schema={spec.schema}
          editable
          blockId={block.id}
          ctx={registryValue.ctx}
        />
      );
      const surface = blockEditSurface(spec);
      if (surface === "panel" && registryValue.ctx.renderEditSurface) {
        editSurface = registryValue.ctx.renderEditSurface({
          title: spec.label,
          open: panelOpen,
          onOpenChange: setPanelOpen,
          blockId: block.id,
          blockType,
          blockTitle: block.title,
          blockSummary: block.summary,
          blockData,
          trigger: (
            <button
              type="button"
              data-plan-interactive
              aria-label={`Edit ${spec.label}`}
              onClick={() => setPanelOpen(true)}
              className="an-block-edit-trigger flex size-7 items-center justify-center rounded-md border border-border bg-background/85 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 data-[visible=true]:opacity-100"
              data-visible={panelOpen || shellHovered}
            >
              <IconPencil className="size-4" />
            </button>
          ),
          children: editorNode,
        });
      } else if (surface === "panel") {
        editSurface = props.selected ? (
          <div className="mt-3">{editorNode}</div>
        ) : null;
      } else {
        body = editorNode;
      }
    }
  } else if (sideMap?.renderLegacyBlock) {
    body = sideMap.renderLegacyBlock(block, { editing: false });
    if (editable && sideMap.onBlockDataChange) {
      editSurface = (
        <LegacyJsonEditSurface
          block={block}
          open={panelOpen}
          onOpenChange={setPanelOpen}
          renderEditSurface={registryValue?.ctx.renderEditSurface}
          onChange={(nextBlock) => commitBlockData(nextBlock)}
          selected={shellHovered}
        />
      );
    }
  } else {
    body = (
      <div className="plan-block-node__fallback rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
        {block.title || blockType || "Unsupported block"}
      </div>
    );
  }

  return (
    <NodeViewWrapper
      className="plan-block-node"
      data-block-id={blockId}
      data-plan-block-selected={props.selected ? "" : undefined}
      data-notion-incompatible={incompatibleWithNotion ? "" : undefined}
      onMouseDownCapture={selectNode}
    >
      <div
        contentEditable={false}
        data-plan-interactive
        className="plan-block-node__shell relative"
        onMouseEnter={updateShellHover}
        onMouseMove={updateShellHover}
        onMouseLeave={() => setShellHovered(false)}
      >
        {incompatibleWithNotion && (
          <span
            className="plan-block-notion-badge"
            title="This block type has no Notion equivalent and won't sync to Notion."
          >
            Won't sync to Notion
          </span>
        )}
        {body}
        {editSurface && (
          <div className="plan-block-node__edit absolute right-2 top-2 z-20">
            {editSurface}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export function LegacyJsonEditSurface({
  block,
  open,
  onOpenChange,
  renderEditSurface,
  onChange,
  selected,
}: {
  block: RegistryBlockSideMapBlock;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renderEditSurface?: BlockRenderContext["renderEditSurface"];
  onChange: (nextData: unknown) => void;
  selected: boolean;
}) {
  const serializedBlockData = useMemo(
    () => JSON.stringify(block.data, null, 2),
    [block.data],
  );
  const [draft, setDraft] = useState(serializedBlockData);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(serializedBlockData);
    setParseError(null);
  }, [block.id, serializedBlockData]);

  const saveDraft = () => {
    try {
      const nextData = JSON.parse(draft) as unknown;
      setParseError(null);
      onChange(nextData);
      onOpenChange(false);
    } catch (error) {
      setParseError(
        error instanceof Error ? error.message : "Invalid JSON data.",
      );
    }
  };

  const trigger = (
    <button
      type="button"
      data-plan-interactive
      aria-label={`Edit ${block.title ?? "block"}`}
      onClick={() => onOpenChange(true)}
      className="an-block-edit-trigger flex size-7 items-center justify-center rounded-md border border-border bg-background/85 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 data-[visible=true]:opacity-100"
      data-visible={selected || open}
    >
      <IconPencil className="size-4" />
    </button>
  );
  const editor = (
    <div className="grid gap-3">
      <textarea
        data-plan-interactive
        className="min-h-64 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        value={draft}
        aria-invalid={parseError ? true : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          if (parseError) setParseError(null);
        }}
      />
      {parseError ? (
        <p className="text-xs text-destructive" role="alert">
          Invalid JSON: {parseError}
        </p>
      ) : null}
      <button
        type="button"
        data-plan-interactive
        className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
        onClick={saveDraft}
      >
        Save
      </button>
    </div>
  );
  if (!renderEditSurface) return open ? editor : trigger;
  return renderEditSurface({
    title: block.title ?? "Block",
    open,
    onOpenChange,
    blockId: block.id,
    blockType:
      typeof (block as { type?: unknown }).type === "string"
        ? ((block as unknown as { type: string }).type ?? "")
        : "legacy",
    blockTitle: block.title,
    blockSummary: block.summary,
    blockData: block.data,
    trigger,
    children: editor,
  });
}

/* -------------------------------------------------------------------------- */
/* A. registry-block Tiptap node factory                                      */
/* -------------------------------------------------------------------------- */

/** Options for {@link createRegistryBlockNode}. */
export interface CreateRegistryBlockNodeOptions {
  /**
   * The Tiptap node name (e.g. `"planBlock"`). Hosts that serialize the doc by
   * node name (plan's `plan-doc.ts` keys off `"planBlock"`) must pass the exact
   * name their serializer expects.
   */
  nodeName: string;
  /**
   * The HTML data-attribute that marks a serialized registry block on copy/paste
   * round-trip (e.g. `"data-plan-block"`).
   */
  dataTag: string;
  /**
   * Mint a fresh, unique block id for a given block type. Used by the dedupe
   * plugin to re-mint duplicate / missing ids (paste/duplicate). Plan passes
   * `createPlanBlockId`.
   */
  mintId: (blockType: string) => string;
  /** Node group (default `"block"`). */
  group?: string;
}

/**
 * Build the generic registry-block Tiptap atom node. Returns a Tiptap `Node`
 * that:
 *  - carries identity attrs `blockType` / `blockId` / `title` / `summary`, a
 *    `sourceBlockId` (set when a duplicate is re-minted, so the host can copy the
 *    original block's data), and an optional `__raw` verbatim-MDX attr for
 *    byte-stable source round-trips;
 *  - is an atom + isolating + draggable block that renders through
 *    {@link RegistryBlockNodeView} (via `ReactNodeViewRenderer`);
 *  - installs a dedupe `appendTransaction` plugin that re-mints any duplicate or
 *    empty `blockId` (the classic paste/duplicate case), preserving the original
 *    block's id + side-map data and tagging its own transaction so it never
 *    loops.
 */
export function createRegistryBlockNode(
  options: CreateRegistryBlockNodeOptions,
) {
  const { nodeName, dataTag, mintId, group = "block" } = options;
  const dedupeKey = new PluginKey(`${nodeName}DedupeIds`);
  const keyboardGuardKey = new PluginKey(`${nodeName}KeyboardGuard`);

  /**
   * Collect every `blockId` currently present on this node type in a doc, with
   * the position of each node, so duplicate ids (from paste/duplicate) can be
   * detected and re-minted.
   */
  function collectEntries(state: EditorState): Array<{
    pos: number;
    blockType: string;
    blockId: string;
    sourceBlockId?: string;
  }> {
    const found: Array<{
      pos: number;
      blockType: string;
      blockId: string;
      sourceBlockId?: string;
    }> = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name === nodeName) {
        found.push({
          pos,
          blockType: String(node.attrs.blockType ?? ""),
          blockId: String(node.attrs.blockId ?? ""),
          sourceBlockId:
            typeof node.attrs.sourceBlockId === "string"
              ? node.attrs.sourceBlockId
              : undefined,
        });
      }
      return true;
    });
    return found;
  }

  /**
   * Build a transaction that re-mints any duplicate / missing ids in `state`, or
   * `null` when nothing needs changing. Only the *later* duplicate (and any node
   * with an empty id) is re-minted, so the original keeps its id and side-map
   * data.
   */
  function buildDedupeTransaction(state: EditorState) {
    const entries = collectEntries(state);
    if (entries.length === 0) return null;

    const seen = new Set<string>();
    let tr = state.tr;
    let changed = false;

    for (const entry of entries) {
      const needsNewId = !entry.blockId || seen.has(entry.blockId);
      if (needsNewId) {
        const freshId = mintId(entry.blockType || "block");
        const node = state.doc.nodeAt(entry.pos);
        if (node) {
          tr = tr.setNodeMarkup(entry.pos, undefined, {
            ...node.attrs,
            blockId: freshId,
            sourceBlockId: entry.sourceBlockId || entry.blockId || null,
          });
          changed = true;
        }
        seen.add(freshId);
      } else {
        seen.add(entry.blockId);
      }
    }

    return changed ? tr.setMeta(dedupeKey, true) : null;
  }

  const selectedRegistryBlock = (state: EditorState) =>
    state.selection instanceof NodeSelection &&
    state.selection.node.type.name === nodeName;

  const isMutatingKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.key === "Enter") return true;
    return event.key.length === 1;
  };

  return Node.create({
    name: nodeName,
    group,
    atom: true,
    draggable: true,
    selectable: true,
    isolating: true,

    addAttributes() {
      return {
        blockType: { default: "" },
        blockId: { default: "" },
        title: { default: null },
        summary: { default: null },
        sourceBlockId: { default: null },
        // Optional verbatim source for hosts that need byte-identical
        // source-format round-trips without React (server pull, hashing). Plan
        // never sets this.
        __raw: { default: null, rendered: false },
      };
    },

    parseHTML() {
      return [
        {
          tag: `div[${dataTag}]`,
          getAttrs: (element) => {
            const node = element as HTMLElement;
            return {
              blockType: node.getAttribute("data-block-type") || "",
              blockId: node.getAttribute("data-block-id") || "",
              title: node.getAttribute("data-title") || null,
              summary: node.getAttribute("data-summary") || null,
              sourceBlockId: node.getAttribute("data-source-block-id") || null,
            };
          },
        },
      ];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        "div",
        mergeAttributes(HTMLAttributes, {
          [dataTag]: "",
          "data-block-type": HTMLAttributes.blockType ?? "",
          "data-block-id": HTMLAttributes.blockId ?? "",
          "data-title": HTMLAttributes.title ?? undefined,
          "data-summary": HTMLAttributes.summary ?? undefined,
          "data-source-block-id": HTMLAttributes.sourceBlockId ?? undefined,
        }),
      ];
    },

    addNodeView() {
      return ReactNodeViewRenderer(RegistryBlockNodeView);
    },

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: dedupeKey,
          appendTransaction(transactions, _oldState, newState) {
            // Ignore our own re-mint, and skip when nothing changed the doc.
            if (
              transactions.some((transaction) =>
                transaction.getMeta(dedupeKey),
              ) ||
              !transactions.some((transaction) => transaction.docChanged)
            ) {
              return null;
            }
            return buildDedupeTransaction(newState);
          },
        }),
        new Plugin({
          key: keyboardGuardKey,
          props: {
            handleClickOn(view, _pos, node, nodePos, event, direct) {
              if (node.type.name !== nodeName || !direct) return false;
              if (
                event.target instanceof HTMLElement &&
                clickedInteractiveChild(event.target)
              ) {
                return false;
              }
              event.preventDefault();
              view.dispatch(
                view.state.tr.setSelection(
                  NodeSelection.create(view.state.doc, nodePos),
                ),
              );
              view.focus();
              return true;
            },
            handleKeyDown(view, event) {
              if (!selectedRegistryBlock(view.state) || !isMutatingKey(event))
                return false;
              event.preventDefault();
              return true;
            },
            handleTextInput(view) {
              return selectedRegistryBlock(view.state);
            },
            handlePaste(view, event) {
              if (!selectedRegistryBlock(view.state)) return false;
              event.preventDefault();
              return true;
            },
            handleDOMEvents: {
              beforeinput(view, event) {
                if (!selectedRegistryBlock(view.state)) return false;
                const inputEvent = event as InputEvent;
                if (
                  !inputEvent.inputType ||
                  (!inputEvent.inputType.startsWith("insert") &&
                    inputEvent.inputType !== "formatSetBlockTextDirection")
                ) {
                  return false;
                }
                event.preventDefault();
                return true;
              },
            },
          },
        }),
      ];
    },
  });
}
