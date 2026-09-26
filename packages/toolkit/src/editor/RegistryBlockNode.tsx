import { IconPencil } from "@tabler/icons-react";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  type EditorState,
} from "@tiptap/pm/state";
import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  useRegistryBlockData,
  type RegistryBlockDataChangeMeta,
  type RegistryBlockEditSurfaceOptions,
  type RegistryBlockSideMapBlock,
} from "./RegistryBlockContext.js";

export {
  RegistryBlockDataProvider,
  useRegistryBlockData,
  type RegistryBlockDataChangeMeta,
  type RegistryBlockDataValue,
  type RegistryBlockEditSurfaceOptions,
  type RegistryBlockNestedBlock,
  type RegistryBlockRenderOptions,
  type RegistryBlockRenderResult,
  type RegistryBlockSideMapBlock,
} from "./RegistryBlockContext.js";


function clickedInteractiveChild(target: HTMLElement) {
  if (target.closest("button,input,textarea,select,a,[role='textbox']")) {
    return true;
  }

  if (
    target.closest(".drag-handle") ||
    target.closest(".plan-nested-document-editor-region")
  ) {
    return true;
  }

  const blockNode = target.closest(".plan-block-node");
  const editable = target.closest("[contenteditable='true']");
  return !!blockNode && !!editable && blockNode.contains(editable);
}

export function selectRegistryBlockNode({
  editable,
  allowInteractiveChild,
  target,
  getPos,
  view,
  preventDefault,
  stopPropagation,
}: {
  editable: boolean;
  allowInteractiveChild: boolean;
  target: EventTarget | null;
  getPos: (() => number | undefined) | boolean;
  view: NodeViewProps["editor"]["view"];
  preventDefault: () => void;
  stopPropagation: () => void;
}): boolean {
  if (!editable) return false;
  if (
    !allowInteractiveChild &&
    target instanceof HTMLElement &&
    clickedInteractiveChild(target)
  )
    return false;
  if (
    allowInteractiveChild &&
    target instanceof HTMLElement &&
    target.closest("pre")
  )
    return false;
  const pos = typeof getPos === "function" ? getPos() : null;
  if (typeof pos !== "number") return false;
  try {
    preventDefault();
    stopPropagation();
    view.dispatch(
      view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
    );
    view.focus();
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}


export function RegistryBlockNodeView(props: NodeViewProps) {
  const blockType = String(props.node.attrs.blockType ?? "");
  const blockId = String(props.node.attrs.blockId ?? "");
  const [panelOpen, setPanelOpen] = useState(false);
  const [shellHovered, setShellHovered] = useState(false);

  const sideMap = useRegistryBlockData();

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
  const commitBlockData = (
    nextData: unknown,
    meta?: RegistryBlockDataChangeMeta,
  ) => {
    setPendingEdit({ data: nextData, base: liveData });
    sideMap?.onBlockDataChange(blockId, nextData, meta);
  };
  const editable = sideMap?.editable ?? false;
  const incompatibleWithNotion =
    (sideMap?.notionSync ?? false) &&
    (sideMap?.isNotionIncompatibleType?.(blockType) ?? false);

  const selectNode = (
    event: ReactMouseEvent<HTMLElement>,
    allowInteractiveChild = false,
  ) => {
    selectRegistryBlockNode({
      editable,
      allowInteractiveChild,
      target: event.target,
      getPos: props.getPos,
      view: props.editor.view,
      preventDefault: () => event.preventDefault(),
      stopPropagation: () => event.stopPropagation(),
    });
  };

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

  if (block.loadError) {
    return (
      <NodeViewWrapper
        className="plan-block-node"
        data-block-id={blockId}
        onMouseDownCapture={(event: ReactMouseEvent<HTMLElement>) =>
          selectNode(event, true)
        }
      >
        <RegistryBlockLoadErrorView
          message={block.loadError.message}
          rawSource={block.loadError.rawSource}
        />
      </NodeViewWrapper>
    );
  }

  const updateShellHover = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    setShellHovered(
      target instanceof HTMLElement &&
        target.closest(".plan-block-node__shell") === event.currentTarget,
    );
  };

  let body: ReactNode;
  let editSurface: ReactNode = null;
  const registered = sideMap?.renderRegisteredBlock?.(block, {
    blockType,
    editable,
    selected: props.selected,
    shellHovered,
    panelOpen,
    setPanelOpen,
    onChange: commitBlockData,
  });
  if (registered) {
    body = registered.body;
    editSurface = registered.editSurface ?? null;
  } else if (sideMap?.renderLegacyBlock) {
    const selfEdits =
      editable && Boolean(sideMap.legacyBlockSelfEdits?.(blockType));
    body = sideMap.renderLegacyBlock(block, { editing: selfEdits });
    if (editable && !selfEdits) {
      const customEditor = sideMap.renderLegacyBlockEditor?.(block, {
        onChange: (nextData) => commitBlockData(nextData),
      });
      editSurface = (
        <LegacyJsonEditSurface
          block={block}
          blockType={blockType}
          open={panelOpen}
          onOpenChange={setPanelOpen}
          renderEditSurface={sideMap.renderEditSurface}
          onChange={(nextBlock) => commitBlockData(nextBlock)}
          selected={shellHovered}
          customEditor={customEditor}
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
      data-block-type={blockType || undefined}
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

export function RegistryBlockLoadErrorView({
  message,
  rawSource,
}: {
  message: string;
  rawSource?: string;
}) {
  return (
    <div
      contentEditable={false}
      data-plan-interactive
      className="plan-block-node__load-error space-y-2 rounded-md border border-border px-3 py-2 text-sm"
    >
      {rawSource ? (
        <pre className="overflow-auto whitespace-pre-wrap font-mono text-xs text-foreground">
          {rawSource}
        </pre>
      ) : null}
      <p role="alert" className="text-muted-foreground">
        {message}
      </p>
    </div>
  );
}

export function LegacyJsonEditSurface({
  block,
  blockType,
  open,
  onOpenChange,
  renderEditSurface,
  onChange,
  selected,
  customEditor,
}: {
  block: RegistryBlockSideMapBlock;
  blockType?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renderEditSurface?: (options: RegistryBlockEditSurfaceOptions) => ReactNode;
  onChange: (nextData: unknown) => void;
  selected: boolean;
  customEditor?: ReactNode;
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
      className="an-block-edit-trigger flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 data-[visible=true]:opacity-100"
      data-visible={selected || open}
    >
      <IconPencil className="size-4" />
    </button>
  );
  const jsonEditor = (
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
      <div className="flex justify-end">
        <button
          type="button"
          data-plan-interactive
          className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
          onClick={saveDraft}
        >
          Save
        </button>
      </div>
    </div>
  );
  const editor = customEditor ?? jsonEditor;
  if (!renderEditSurface) return open ? editor : trigger;
  return renderEditSurface({
    title: block.title ?? "Block",
    open,
    onOpenChange,
    blockId: block.id,
    blockType:
      blockType ||
      (typeof (block as { type?: unknown }).type === "string"
        ? ((block as unknown as { type: string }).type ?? "")
        : "legacy"),
    blockTitle: block.title,
    blockSummary: block.summary,
    blockData: block.data,
    trigger,
    children: editor,
  });
}


export interface CreateRegistryBlockNodeOptions {
  nodeName: string;
  dataTag: string;
  mintId: (blockType: string) => string;
  group?: string;
}

export function createRegistryBlockNode(
  options: CreateRegistryBlockNodeOptions,
) {
  const { nodeName, dataTag, mintId, group = "block" } = options;
  const dedupeKey = new PluginKey(`${nodeName}DedupeIds`);
  const keyboardGuardKey = new PluginKey(`${nodeName}KeyboardGuard`);

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
