import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBold,
  IconCheck,
  IconChevronDown,
  IconItalic,
  IconUnderline,
  IconStrikethrough,
  IconCode,
  IconDots,
  IconLink,
  IconLinkOff,
  IconList,
  IconListNumbers,
  IconMessageCircle,
  IconSquareCheck,
  IconX,
} from "@tabler/icons-react";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  type EditorState,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
} from "react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useElementWidthValue } from "@/hooks/use-element-width-value";
import { cn } from "@/lib/utils";

import {
  captureAnchor,
  trimSelectionRange,
  type CommentTextAnchor,
} from "./comment-anchors";
import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";
import { suggestionHighlightKey } from "./extensions/SuggestionHighlight";

export type CommentRange = { from: number; to: number };

export interface BubbleToolbarProps {
  editor: Editor;
  onComment?: (
    quotedText: string,
    offsetTop: number,
    anchor?: CommentTextAnchor,
    range?: CommentRange,
    suggestionId?: string,
  ) => void;
  /**
   * Render as an always-visible strip with touch-sized targets instead of the
   * floating selection bubble. Adds list and history actions; omits comments.
   */
  docked?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

// Suggested text exists only in the author's draft, so a page comment anchored
// to it has nothing to point at once the draft is saved; it belongs on the
// suggestion's own thread.
export function draftSuggestionIdInRange(
  state: EditorState,
  from: number,
  to: number,
) {
  return suggestionHighlightKey
    .getState(state)
    ?.specs.find(
      (spec) =>
        spec.editableText && !spec.settling && spec.to > from && to > spec.from,
    )?.suggestionId;
}

const BUBBLE_TOOLBAR_EXCLUDED_NODE_TYPES = new Set([
  "image",
  "video",
  "audio",
  "contentReference",
  "localMdxComponent",
]);

type SelectionFillRange = {
  from: number;
  to: number;
};

type TextStyle = "paragraph" | 1 | 2 | 3 | 4 | 5 | 6;
type ColorAttribute = "color" | "bgColor";
type ColorName =
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

const COLOR_NAMES: ColorName[] = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
];

export function getSelectionNotionSpanAttribute(
  editor: Editor,
  attribute: ColorAttribute | "underline",
): "mixed" | (string & {}) | null {
  const { from, to } = editor.state.selection;
  const markType = editor.state.schema.marks.notionSpan;
  if (!markType) return null;

  let observed: string | null = null;
  let hasObserved = false;
  let mixed = false;

  editor.state.doc.nodesBetween(from, to, (node, _position, parent) => {
    if (!node.isText || !parent?.type.allowsMarkType(markType)) return;
    const mark = node.marks.find((candidate) => candidate.type === markType);
    const value = (mark?.attrs[attribute] as string | null | undefined) ?? null;
    if (!hasObserved) {
      observed = value;
      hasObserved = true;
    } else if (observed !== value) {
      mixed = true;
    }
  });

  return mixed ? "mixed" : observed;
}

export function selectionHasColorableText(
  state: EditorState,
  from: number,
  to: number,
) {
  const markType = state.schema.marks.notionSpan;
  if (!markType) return false;

  let hasText = false;
  state.doc.nodesBetween(from, to, (node, _position, parent) => {
    if (node.isText && parent?.type.allowsMarkType(markType)) hasText = true;
    return !hasText;
  });
  return hasText;
}

type ToolbarAction = {
  icon: React.ElementType;
  title: string;
  action: () => void;
  isActive: () => boolean;
  /** Docked strip only: a one-shot command with no on/off state. */
  momentary?: boolean;
  /** Docked strip only: the floating bubble never shows without a selection. */
  disabled?: () => boolean;
};

type DockedEntry =
  | { id: string; kind: "text-style" }
  | { id: string; kind: "color" }
  | { id: string; kind: "action"; item: ToolbarAction };

// One touch-sized cell per control. The strip lays out whole cells and moves
// what does not fit into the overflow menu.
const DOCKED_CELL_PX = 44;
// Until the strip is measured, assume the narrowest inline frame so no control
// is ever laid out past the edge.
const DOCKED_UNMEASURED_SLOTS = 8;

const dockedButtonFill =
  "flex size-9 items-center justify-center rounded-md group-hover:bg-accent group-hover:text-accent-foreground group-aria-pressed:bg-accent group-aria-pressed:text-accent-foreground group-data-[state=open]:bg-accent group-data-[state=open]:text-accent-foreground";

const DockedButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      "group flex size-11 shrink-0 items-center justify-center rounded-md text-foreground/80 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
      className,
    )}
    {...props}
  >
    <span className={dockedButtonFill}>{children}</span>
  </button>
));
DockedButton.displayName = "DockedButton";

function toolbarEditChain(editor: Editor) {
  if (!editor.isEditable) return null;
  return editor.chain().command(({ tr }) => {
    tr.setMeta(LOCAL_FILE_USER_EDIT_META, true);
    return true;
  });
}

export function setSelectionNotionSpanAttribute(
  editor: Editor,
  attribute: ColorAttribute | "underline",
  value: string | null,
) {
  if (!editor.isEditable) return false;
  const { state } = editor;
  const { from, to } = state.selection;
  const markType = state.schema.marks.notionSpan;
  if (!markType || from === to) return false;

  const transaction = state.tr;
  if (attribute === "underline" && state.schema.marks.underline) {
    transaction.removeMark(from, to, state.schema.marks.underline);
  }
  state.doc.nodesBetween(from, to, (node, position, parent) => {
    if (!node.isText || !parent?.type.allowsMarkType(markType)) return;
    const start = Math.max(from, position);
    const end = Math.min(to, position + node.nodeSize);
    if (start >= end) return;

    const existing = node.marks.find((mark) => mark.type === markType);
    const attrs = { ...existing?.attrs, [attribute]: value };
    transaction.removeMark(start, end, markType);
    if (
      attrs.color ||
      attrs.bgColor ||
      attrs.underline ||
      attrs.href ||
      (attrs.attrsJson && attrs.attrsJson !== "{}")
    ) {
      transaction.addMark(start, end, markType.create(attrs));
    }
  });

  if (!transaction.docChanged) return false;
  transaction.setMeta(LOCAL_FILE_USER_EDIT_META, true);
  editor.view.dispatch(transaction);
  editor.commands.focus();
  return true;
}

function activeTextStyle(editor: Editor): TextStyle {
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    if (editor.isActive("heading", { level })) return level;
  }
  return "paragraph";
}

const selectionFillPluginKey = new PluginKey<SelectionFillRange | null>(
  "contentSelectionFill",
);

function selectionIncludesBubbleToolbarExcludedNode(
  state: EditorState,
  from: number,
  to: number,
) {
  if (
    state.selection instanceof NodeSelection &&
    BUBBLE_TOOLBAR_EXCLUDED_NODE_TYPES.has(state.selection.node.type.name)
  ) {
    return true;
  }

  let includesExcludedNode = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (BUBBLE_TOOLBAR_EXCLUDED_NODE_TYPES.has(node.type.name)) {
      includesExcludedNode = true;
      return false;
    }
    return !includesExcludedNode;
  });
  return includesExcludedNode;
}

export function shouldShowBubbleToolbar({
  editor,
  element,
  state,
  from,
  to,
}: {
  editor: Editor;
  element: HTMLElement;
  state: EditorState;
  from: number;
  to: number;
}) {
  const focusBelongsToToolbar = element.contains(document.activeElement);
  if (!editor.view.hasFocus() && !focusBelongsToToolbar) return false;
  if (from === to) return false;
  return !selectionIncludesBubbleToolbarExcludedNode(state, from, to);
}

export function BubbleToolbar({
  editor,
  onComment,
  docked = false,
  onUndo,
  onRedo,
}: BubbleToolbarProps) {
  const t = useT();
  const [bubbleMenuKey] = useState(() => new PluginKey("contentBubbleToolbar"));
  const dockedRef = useRef<HTMLDivElement>(null);
  const dockedSlots = useElementWidthValue(
    dockedRef,
    (width) => Math.max(2, Math.floor(width / DOCKED_CELL_PX)),
    DOCKED_UNMEASURED_SLOTS,
    docked,
  );
  const [overflowOpen, setOverflowOpen] = useState(false);
  const pendingOverflowAction = useRef<(() => void) | null>(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [textStyleOpen, setTextStyleOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [colorRevision, setColorRevision] = useState(0);
  const [recentColor, setRecentColor] = useState<{
    attribute: ColorAttribute;
    value: string;
  } | null>(null);
  const textStyleSelection = useRef<{ from: number; to: number } | null>(null);
  const colorSelection = useRef<{ from: number; to: number } | null>(null);
  const textStyleApplied = useRef(false);
  const colorApplied = useRef(false);
  const restoreEditorFocusOnClose = useRef(false);
  const [textStyle, setTextStyle] = useState<TextStyle>(() =>
    activeTextStyle(editor),
  );

  useEffect(() => {
    if (docked || typeof ResizeObserver === "undefined") return;
    const target = editor.view.dom;
    let previousSize: { width: number; height: number } | undefined;
    let frame: number | undefined;
    let disposed = false;
    const observer = new ResizeObserver((entries) => {
      if (disposed) return;
      const entry = entries.find((candidate) => candidate.target === target);
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (previousSize?.width === width && previousSize.height === height)
        return;
      previousSize = { width, height };
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (disposed || editor.isDestroyed) return;
        editor.view.dispatch(
          editor.state.tr.setMeta(bubbleMenuKey, "updatePosition"),
        );
      });
    });
    observer.observe(target);
    return () => {
      disposed = true;
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [editor, bubbleMenuKey, docked]);

  const createCommentFromSelection = useCallback(() => {
    if (!onComment) return false;
    const { from, to } = trimSelectionRange(
      editor.state.doc,
      editor.state.selection.from,
      editor.state.selection.to,
    );
    const text = editor.state.doc.textBetween(from, to, " ");
    if (!text.trim()) return false;
    const anchor = captureAnchor(editor.state.doc, from, to);
    const suggestionId = draftSuggestionIdInRange(editor.state, from, to);
    const coords = editor.view.coordsAtPos(from);
    const scrollContainer = editor.view.dom.closest(
      ".flex-1.min-h-0.overflow-auto",
    );
    const containerTop = scrollContainer
      ? scrollContainer.getBoundingClientRect().top
      : 0;
    const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
    const offsetTop = coords.top - containerTop + scrollTop;
    editor.commands.setTextSelection(from);
    onComment(text.trim(), offsetTop, anchor, { from, to }, suggestionId);
    return true;
  }, [editor, onComment]);

  useEffect(() => {
    if (!onComment) return;
    const dom = editor.view.dom;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "m" ||
        !event.shiftKey ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }
      if (createCommentFromSelection()) event.preventDefault();
    };
    dom.addEventListener("keydown", handleKeyDown);
    return () => dom.removeEventListener("keydown", handleKeyDown);
  }, [createCommentFromSelection, editor, onComment]);

  useEffect(() => {
    const syncTextStyle = () => {
      setTextStyle(activeTextStyle(editor));
      setColorRevision((revision) => revision + 1);
      const { from, to } = editor.state.selection;
      if (from !== to) {
        textStyleSelection.current = { from, to };
        colorSelection.current = { from, to };
      } else if (docked) {
        // The docked strip stays visible with a caret; a range remembered from
        // an earlier selection must not be restored over it.
        textStyleSelection.current = null;
        colorSelection.current = null;
      }
    };
    editor.on("selectionUpdate", syncTextStyle);
    editor.on("transaction", syncTextStyle);
    syncTextStyle();
    return () => {
      editor.off("selectionUpdate", syncTextStyle);
      editor.off("transaction", syncTextStyle);
    };
  }, [editor, docked]);

  const textStyles = [
    {
      value: "paragraph" as const,
      shortLabel: t("editor.slash.text"),
      menuLabel: "T",
      label: t("editor.slash.text"),
    },
    {
      value: 1 as const,
      shortLabel: "H1",
      menuLabel: "H1",
      label: t("editor.heading1"),
    },
    {
      value: 2 as const,
      shortLabel: "H2",
      menuLabel: "H2",
      label: t("editor.heading2"),
    },
    {
      value: 3 as const,
      shortLabel: "H3",
      menuLabel: "H3",
      label: t("editor.heading3"),
    },
    {
      value: 4 as const,
      shortLabel: "H4",
      menuLabel: "H4",
      label: t("editor.heading4"),
    },
  ];
  const selectedTextStyle =
    textStyles.find((style) => style.value === textStyle) ??
    (typeof textStyle === "number"
      ? {
          value: textStyle,
          shortLabel: `H${textStyle}`,
          menuLabel: `H${textStyle}`,
          label: textStyle === 5 ? t("editor.heading5") : t("editor.heading6"),
        }
      : textStyles[0]);

  const applyTextStyle = (style: TextStyle) => {
    const chain = toolbarEditChain(editor);
    if (!chain) return;
    if (textStyleSelection.current) {
      chain.setTextSelection(textStyleSelection.current);
    }
    if (style === "paragraph") {
      chain.setNode("paragraph").focus().run();
    } else {
      chain.setHeading({ level: style }).focus().run();
    }
    textStyleApplied.current = true;
    setTextStyle(style);
    setTextStyleOpen(false);
  };

  const applyColor = (attribute: ColorAttribute, value: string | null) => {
    if (!editor.isEditable) return;
    if (colorSelection.current) {
      editor.commands.setTextSelection(colorSelection.current);
    }
    if (!setSelectionNotionSpanAttribute(editor, attribute, value)) return;
    if (value) setRecentColor({ attribute, value });
    colorApplied.current = true;
    setColorOpen(false);
    if (overflowOpen) {
      pendingOverflowAction.current = () => editor.commands.focus();
      setOverflowOpen(false);
    }
  };

  const activeTextColor = getSelectionNotionSpanAttribute(editor, "color");
  const activeBackgroundColor = getSelectionNotionSpanAttribute(
    editor,
    "bgColor",
  );
  void colorRevision;

  const renderColorChoice = (
    attribute: ColorAttribute,
    value: string | null,
  ) => {
    const sectionLabel = t(
      attribute === "color" ? "editor.textColor" : "editor.backgroundColor",
    );
    const colorName = value?.replace(/_bg$/, "") as ColorName | undefined;
    const choiceLabel = colorName
      ? t(`editor.color.${colorName}`)
      : t("editor.defaultColor");
    const activeValue =
      attribute === "color" ? activeTextColor : activeBackgroundColor;
    const isActive = activeValue !== "mixed" && activeValue === value;

    return (
      <button
        key={`${attribute}-${value ?? "default"}`}
        type="button"
        role="menuitemradio"
        aria-checked={isActive}
        aria-label={`${sectionLabel}: ${choiceLabel}`}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          applyColor(attribute, value);
        }}
        onClick={(event) => {
          if (event.detail === 0) applyColor(attribute, value);
        }}
        className={cn(
          "relative flex items-center justify-center rounded-md border border-border bg-background text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          docked ? "size-11" : "size-8",
          isActive && "ring-2 ring-foreground",
        )}
      >
        {attribute === "color" ? (
          <span className={colorName ? `notion-block-color--${colorName}` : ""}>
            A
          </span>
        ) : (
          <span
            className={cn(
              "size-5 rounded border border-border",
              colorName && `notion-block-bg--${colorName}`,
            )}
          />
        )}
        {isActive ? (
          <IconCheck
            aria-hidden="true"
            className="absolute -end-1 -top-1 rounded-full bg-foreground p-0.5 text-background"
            size={12}
            strokeWidth={3}
          />
        ) : null}
      </button>
    );
  };

  const openLinkInput = useCallback(() => {
    setLinkUrl(editor.getAttributes("link").href || "");
    setShowLinkInput(true);
  }, [editor]);

  useEffect(() => {
    const plugin = new Plugin<SelectionFillRange | null>({
      key: selectionFillPluginKey,
      state: {
        init: () => null,
        apply: (tr, value) => {
          const meta = tr.getMeta(selectionFillPluginKey);
          if (meta !== undefined) return meta;
          return value
            ? {
                from: tr.mapping.map(value.from),
                to: tr.mapping.map(value.to),
              }
            : null;
        },
      },
      props: {
        handleKeyDown(_view, event) {
          if (
            !(event.metaKey || event.ctrlKey) ||
            event.shiftKey ||
            event.altKey ||
            event.key.toLowerCase() !== "k"
          ) {
            return false;
          }

          const { state } = editor;
          const { from, to } = state.selection;
          if (
            from === to ||
            selectionIncludesBubbleToolbarExcludedNode(state, from, to)
          ) {
            return false;
          }

          event.preventDefault();
          openLinkInput();
          return true;
        },
        decorations(state) {
          const range = selectionFillPluginKey.getState(state);
          if (!range || range.from === range.to) return DecorationSet.empty;
          return DecorationSet.create(state.doc, [
            Decoration.inline(range.from, range.to, {
              class: "notion-selection-fill",
            }),
          ]);
        },
      },
    });

    editor.registerPlugin(plugin);

    const syncSelectionFill = () => {
      const { state } = editor;
      const { from, to } = state.selection;
      const nextRange =
        editor.isFocused &&
        from !== to &&
        !selectionIncludesBubbleToolbarExcludedNode(state, from, to)
          ? { from, to }
          : null;
      const currentRange = selectionFillPluginKey.getState(state);
      if (
        currentRange?.from === nextRange?.from &&
        currentRange?.to === nextRange?.to
      ) {
        return;
      }
      editor.view.dispatch(
        state.tr
          .setMeta(selectionFillPluginKey, nextRange)
          .setMeta("addToHistory", false),
      );
    };

    editor.on("selectionUpdate", syncSelectionFill);
    editor.on("focus", syncSelectionFill);
    editor.on("blur", syncSelectionFill);
    syncSelectionFill();

    return () => {
      editor.off("selectionUpdate", syncSelectionFill);
      editor.off("focus", syncSelectionFill);
      editor.off("blur", syncSelectionFill);
      editor.unregisterPlugin(selectionFillPluginKey);
    };
  }, [editor, openLinkInput]);

  const closeLinkInput = () => {
    setShowLinkInput(false);
    setLinkUrl("");
  };

  const handleSetLink = () => {
    const chain = toolbarEditChain(editor);
    if (!chain) return;
    if (linkUrl.trim()) {
      chain
        .focus()
        .extendMarkRange("link")
        .setLink({ href: linkUrl.trim() })
        .run();
    } else {
      chain.focus().extendMarkRange("link").unsetLink().run();
    }
    closeLinkInput();
  };

  const handleRemoveLink = () => {
    toolbarEditChain(editor)?.focus().extendMarkRange("link").unsetLink().run();
    closeLinkInput();
  };

  const toggleLink = () => {
    openLinkInput();
  };

  const boldItem: ToolbarAction = {
    icon: IconBold,
    title: t("editor.bold"),
    action: () => toolbarEditChain(editor)?.focus().toggleBold().run(),
    isActive: () => editor.isActive("bold"),
  };
  const italicItem: ToolbarAction = {
    icon: IconItalic,
    title: t("editor.italic"),
    action: () => toolbarEditChain(editor)?.focus().toggleItalic().run(),
    isActive: () => editor.isActive("italic"),
  };
  const underlineItem: ToolbarAction = {
    icon: IconUnderline,
    title: t("editor.underline"),
    action: () => {
      if (!editor.isEditable) return;
      const active =
        editor.isActive("underline") ||
        getSelectionNotionSpanAttribute(editor, "underline") === "true";
      editor.commands.focus();
      setSelectionNotionSpanAttribute(
        editor,
        "underline",
        active ? null : "true",
      );
    },
    isActive: () =>
      editor.isActive("underline") ||
      getSelectionNotionSpanAttribute(editor, "underline") === "true",
    disabled: () => editor.state.selection.empty,
  };
  const strikeItem: ToolbarAction = {
    icon: IconStrikethrough,
    title: t("editor.strikethrough"),
    action: () => toolbarEditChain(editor)?.focus().toggleStrike().run(),
    isActive: () => editor.isActive("strike"),
  };
  const codeItem: ToolbarAction = {
    icon: IconCode,
    title: t("editor.code"),
    action: () => toolbarEditChain(editor)?.focus().toggleCode().run(),
    isActive: () => editor.isActive("code"),
  };
  const linkItem: ToolbarAction = {
    icon: IconLink,
    title: t("editor.link"),
    action: toggleLink,
    isActive: () => editor.isActive("link"),
    disabled: () => editor.state.selection.empty && !editor.isActive("link"),
  };

  const colorable = selectionHasColorableText(
    editor.state,
    editor.state.selection.from,
    editor.state.selection.to,
  );

  const items = [
    { type: "text-style" as const },
    ...(colorable ? [{ type: "color" as const }] : []),
    { type: "divider" as const },
    boldItem,
    italicItem,
    underlineItem,
    strikeItem,
    codeItem,
    { type: "divider" as const },
    linkItem,
    ...(onComment
      ? [
          { type: "divider" as const },
          {
            icon: IconMessageCircle,
            title: t("editor.comment"),
            action: createCommentFromSelection,
            isActive: () => false,
          },
        ]
      : []),
  ];

  // Docked strip, highest priority first: later entries overflow first.
  const dockedEntries: DockedEntry[] = docked
    ? [
        { id: "text-style", kind: "text-style" },
        { id: "bold", kind: "action", item: boldItem },
        { id: "italic", kind: "action", item: italicItem },
        {
          id: "bulletList",
          kind: "action",
          item: {
            icon: IconList,
            title: t("editor.slash.bulletedList"),
            action: () =>
              toolbarEditChain(editor)?.focus().toggleBulletList().run(),
            isActive: () => editor.isActive("bulletList"),
          },
        },
        {
          id: "orderedList",
          kind: "action",
          item: {
            icon: IconListNumbers,
            title: t("editor.slash.numberedList"),
            action: () =>
              toolbarEditChain(editor)?.focus().toggleOrderedList().run(),
            isActive: () => editor.isActive("orderedList"),
          },
        },
        { id: "link", kind: "action", item: linkItem },
        ...(onUndo
          ? [
              {
                id: "undo",
                kind: "action" as const,
                item: {
                  icon: IconArrowBackUp,
                  title: t("editor.toolbar.undo"),
                  action: onUndo,
                  isActive: () => false,
                  momentary: true,
                  disabled: () => !editor.can().undo(),
                },
              },
            ]
          : []),
        ...(onRedo
          ? [
              {
                id: "redo",
                kind: "action" as const,
                item: {
                  icon: IconArrowForwardUp,
                  title: t("editor.toolbar.redo"),
                  action: onRedo,
                  isActive: () => false,
                  momentary: true,
                  disabled: () => !editor.can().redo(),
                },
              },
            ]
          : []),
        { id: "underline", kind: "action", item: underlineItem },
        { id: "strike", kind: "action", item: strikeItem },
        { id: "code", kind: "action", item: codeItem },
        { id: "color", kind: "color" },
        ...(editor.schema.nodes.taskList
          ? [
              {
                id: "taskList",
                kind: "action" as const,
                item: {
                  icon: IconSquareCheck,
                  title: t("editor.slash.todoList"),
                  action: () =>
                    toolbarEditChain(editor)?.focus().toggleTaskList().run(),
                  isActive: () => editor.isActive("taskList"),
                },
              },
            ]
          : []),
      ]
    : [];
  const dockedVisibleCount =
    dockedEntries.length <= dockedSlots
      ? dockedEntries.length
      : dockedSlots - 1;
  const dockedVisible = dockedEntries.slice(0, dockedVisibleCount);
  const dockedOverflow = dockedEntries.slice(dockedVisibleCount);
  const hasDockedOverflow = dockedOverflow.length > 0;

  useEffect(() => {
    if (!hasDockedOverflow) setOverflowOpen(false);
  }, [hasDockedOverflow]);

  const renderTextStyle = () => (
    <Popover
      key="text-style"
      open={textStyleOpen}
      onOpenChange={(open) => {
        if (open) {
          textStyleApplied.current = false;
          restoreEditorFocusOnClose.current = false;
          const { from, to } = editor.state.selection;
          if (from !== to) textStyleSelection.current = { from, to };
        }
        setTextStyleOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        {docked ? (
          <DockedButton
            aria-label={`${t("editor.slash.turnInto")}: ${selectedTextStyle.label}`}
          >
            <span className="flex items-center gap-0.5 text-sm font-semibold">
              <span>{selectedTextStyle.menuLabel}</span>
              <IconChevronDown size={12} strokeWidth={2} />
            </span>
          </DockedButton>
        ) : (
          <button
            type="button"
            aria-label={`${t("editor.slash.turnInto")}: ${selectedTextStyle.label}`}
            className="flex h-8 min-w-14 items-center justify-between gap-1 rounded px-2 text-sm font-medium text-popover-foreground/85 hover:bg-accent hover:text-accent-foreground"
          >
            <span>{selectedTextStyle.shortLabel}</span>
            <IconChevronDown size={14} strokeWidth={2} />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        portalled={false}
        align="start"
        sideOffset={docked ? 4 : 24}
        collisionPadding={docked ? 8 : undefined}
        className={docked ? "w-52 p-1" : "w-44 p-1"}
        onEscapeKeyDown={() => {
          restoreEditorFocusOnClose.current = true;
          window.setTimeout(() => editor.commands.focus(), 0);
        }}
        onCloseAutoFocus={(event) => {
          if (textStyleApplied.current || restoreEditorFocusOnClose.current) {
            event.preventDefault();
          }
          if (restoreEditorFocusOnClose.current) {
            editor.commands.focus();
          }
          textStyleApplied.current = false;
          restoreEditorFocusOnClose.current = false;
        }}
      >
        <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
          {t("editor.slash.turnInto")}
        </div>
        <div
          role="menu"
          aria-label={t("editor.slash.turnInto")}
          className="flex flex-col gap-0.5"
        >
          {textStyles.map((style) => {
            const isSelected = style.value === textStyle;
            return (
              <button
                key={style.value}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  applyTextStyle(style.value);
                }}
                onClick={(event) => {
                  if (event.detail === 0) {
                    applyTextStyle(style.value);
                  }
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 text-left text-sm",
                  docked ? "h-11" : "h-8",
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "text-popover-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span className="w-6 shrink-0 text-xs font-semibold text-muted-foreground">
                  {style.menuLabel}
                </span>
                <span className="flex-1">{style.label}</span>
                {isSelected ? <IconCheck size={15} strokeWidth={2.25} /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );

  const colorPanel = (
    <>
      {recentColor ? (
        <div className="mb-2">
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            {t("editor.color.recentlyUsed")}
          </div>
          <div role="menu">
            {renderColorChoice(recentColor.attribute, recentColor.value)}
          </div>
        </div>
      ) : null}
      <div className="mb-2">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {t("editor.textColor")}
        </div>
        <div
          role="menu"
          aria-label={t("editor.textColor")}
          className="grid grid-cols-5 gap-1"
        >
          {renderColorChoice("color", null)}
          {COLOR_NAMES.map((name) => renderColorChoice("color", name))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {t("editor.backgroundColor")}
        </div>
        <div
          role="menu"
          aria-label={t("editor.backgroundColor")}
          className="grid grid-cols-5 gap-1"
        >
          {renderColorChoice("bgColor", null)}
          {COLOR_NAMES.map((name) =>
            renderColorChoice("bgColor", `${name}_bg`),
          )}
        </div>
      </div>
    </>
  );

  const renderColor = () => (
    <Popover
      key="color"
      open={colorOpen}
      onOpenChange={(open) => {
        if (open) {
          colorApplied.current = false;
          restoreEditorFocusOnClose.current = false;
          const { from, to } = editor.state.selection;
          if (from !== to) colorSelection.current = { from, to };
        }
        setColorOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        {docked ? (
          <DockedButton
            aria-label={t("editor.color.label")}
            disabled={!colorable}
          >
            <span className="text-sm font-semibold">A</span>
          </DockedButton>
        ) : (
          <button
            type="button"
            aria-label={t("editor.color.label")}
            className={cn(
              "flex size-8 items-center justify-center rounded text-sm font-semibold text-popover-foreground/85 hover:bg-accent hover:text-accent-foreground",
              colorOpen && "bg-accent text-accent-foreground",
            )}
          >
            A
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        portalled={false}
        align="start"
        sideOffset={docked ? 4 : 24}
        collisionPadding={docked ? 8 : undefined}
        className={docked ? "w-64 p-2" : "w-52 p-2"}
        onEscapeKeyDown={() => {
          restoreEditorFocusOnClose.current = true;
          window.setTimeout(() => editor.commands.focus(), 0);
        }}
        onCloseAutoFocus={(event) => {
          if (colorApplied.current || restoreEditorFocusOnClose.current) {
            event.preventDefault();
          }
          if (restoreEditorFocusOnClose.current) {
            editor.commands.focus();
          }
          colorApplied.current = false;
          restoreEditorFocusOnClose.current = false;
        }}
      >
        {colorPanel}
      </PopoverContent>
    </Popover>
  );

  const keepEditorSelection = (event: MouseEvent<HTMLElement>) => {
    // The link field must take focus; every other control must not.
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
  };

  const renderDockedAction = (id: string, item: ToolbarAction) => {
    const Icon = item.icon;
    return (
      <Tooltip key={id}>
        <TooltipTrigger asChild>
          <DockedButton
            aria-label={item.title}
            aria-pressed={item.momentary ? undefined : item.isActive()}
            disabled={item.disabled?.()}
            onClick={() => item.action()}
          >
            <Icon size={18} strokeWidth={2} />
          </DockedButton>
        </TooltipTrigger>
        <TooltipContent>{item.title}</TooltipContent>
      </Tooltip>
    );
  };

  const renderDockedOverflow = () => (
    <DropdownMenu open={overflowOpen} onOpenChange={setOverflowOpen}>
      <DropdownMenuTrigger asChild>
        <DockedButton aria-label={t("editor.media.more")}>
          <IconDots size={18} strokeWidth={2} />
        </DockedButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        collisionPadding={8}
        className="min-w-52"
        onCloseAutoFocus={(event) => {
          // Run after the menu has released focus, so the command's own focus
          // (editor or link field) is not pulled back to the trigger.
          const pending = pendingOverflowAction.current;
          pendingOverflowAction.current = null;
          if (!pending) return;
          event.preventDefault();
          pending();
        }}
      >
        {dockedOverflow.map((entry) => {
          if (entry.kind === "color") {
            return (
              <DropdownMenuSub key={entry.id}>
                <DropdownMenuSubTrigger
                  inset
                  disabled={!colorable}
                  className="h-11 gap-3"
                >
                  <span aria-hidden="true" className="text-sm font-semibold">
                    A
                  </span>
                  {t("editor.color.label")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  collisionPadding={8}
                  className="w-64 p-2"
                >
                  {colorPanel}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          }
          if (entry.kind !== "action") return null;
          const { item } = entry;
          const Icon = item.icon;
          const onSelect = () => {
            pendingOverflowAction.current = item.action;
          };
          const content = (
            <>
              <Icon size={18} strokeWidth={2} />
              <span>{item.title}</span>
            </>
          );
          return item.momentary ? (
            <DropdownMenuItem
              key={entry.id}
              inset
              disabled={item.disabled?.()}
              onSelect={onSelect}
              className="h-11 gap-3"
            >
              {content}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuCheckboxItem
              key={entry.id}
              checked={item.isActive()}
              disabled={item.disabled?.()}
              onSelect={onSelect}
              className="h-11 gap-3"
            >
              {content}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (docked) {
    return (
      <div
        ref={dockedRef}
        role="toolbar"
        aria-label={t("editor.toolbar.formatting")}
        data-content-widget-format-toolbar=""
        className="flex h-12 w-full min-w-0 shrink-0 items-center border-b bg-background"
        onMouseDown={keepEditorSelection}
      >
        {showLinkInput ? (
          <div className="flex min-w-0 flex-1 items-center gap-1 ps-3">
            <input
              autoFocus
              type="url"
              aria-label={t("editor.pasteLink")}
              placeholder={t("editor.pasteLink")}
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSetLink();
                if (e.key === "Escape") closeLinkInput();
              }}
              className="h-11 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={handleSetLink}
              className="h-11 shrink-0 rounded-md px-3 text-sm font-medium text-primary outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {t("editor.apply")}
            </button>
            {editor.isActive("link") ? (
              <DockedButton
                aria-label={t("editor.removeLink")}
                onClick={handleRemoveLink}
              >
                <IconLinkOff size={18} strokeWidth={2} />
              </DockedButton>
            ) : null}
            <DockedButton
              aria-label={t("comments.cancel")}
              onClick={closeLinkInput}
            >
              <IconX size={18} strokeWidth={2} />
            </DockedButton>
          </div>
        ) : (
          <>
            {dockedVisible.map((entry) => {
              if (entry.kind === "text-style") return renderTextStyle();
              if (entry.kind === "color") return renderColor();
              return renderDockedAction(entry.id, entry.item);
            })}
            {hasDockedOverflow ? renderDockedOverflow() : null}
          </>
        )}
      </div>
    );
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={bubbleMenuKey}
      className="bubble-toolbar"
      updateDelay={0}
      shouldShow={shouldShowBubbleToolbar}
    >
      {showLinkInput ? (
        <div
          className="flex items-center gap-1 px-1"
          onMouseDown={(e) => e.preventDefault()}
        >
          <input
            autoFocus
            type="url"
            aria-label={t("editor.pasteLink")}
            placeholder={t("editor.pasteLink")}
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSetLink();
              if (e.key === "Escape") closeLinkInput();
            }}
            className="bg-transparent border-none outline-none text-popover-foreground text-sm w-40 sm:w-48 px-1 py-1 placeholder:text-muted-foreground"
          />
          <button
            onClick={handleSetLink}
            className="text-xs text-primary hover:text-primary/80 px-2 py-1.5 font-medium"
          >
            {t("editor.apply")}
          </button>
          {editor.isActive("link") ? (
            <button
              type="button"
              onClick={handleRemoveLink}
              className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {t("editor.removeLink")}
            </button>
          ) : null}
        </div>
      ) : (
        <div
          className="flex max-w-[calc(100vw-1rem)] items-center gap-0.5"
          onMouseDown={(e) => e.preventDefault()}
        >
          {items.map((item, i) => {
            if ("type" in item && item.type === "divider") {
              return (
                <div key={`d-${i}`} className="w-px h-5 bg-border mx-0.5" />
              );
            }
            if ("type" in item && item.type === "text-style") {
              return renderTextStyle();
            }
            if ("type" in item && item.type === "color") {
              return renderColor();
            }
            const {
              icon: Icon,
              title,
              action,
              isActive,
            } = item as ToolbarAction;
            return (
              <Tooltip key={title}>
                <TooltipTrigger asChild>
                  <button
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      action();
                    }}
                    onClick={(event) => {
                      if (event.detail === 0) action();
                    }}
                    aria-label={title}
                    className={cn(
                      "p-2 rounded",
                      isActive()
                        ? "bg-accent text-accent-foreground"
                        : "text-popover-foreground/75 hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <Icon size={16} strokeWidth={2.5} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{title}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}
    </BubbleMenu>
  );
}
