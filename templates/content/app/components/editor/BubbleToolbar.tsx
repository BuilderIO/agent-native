import { useT } from "@agent-native/core/client/i18n";
import {
  IconBold,
  IconCheck,
  IconChevronDown,
  IconItalic,
  IconStrikethrough,
  IconCode,
  IconLink,
  IconMessageCircle,
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
import { useCallback, useEffect, useRef, useState } from "react";

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
import { cn } from "@/lib/utils";

import { captureAnchor, type CommentTextAnchor } from "./comment-anchors";

export type CommentRange = { from: number; to: number };

export interface BubbleToolbarProps {
  editor: Editor;
  onComment?: (
    quotedText: string,
    offsetTop: number,
    anchor?: CommentTextAnchor,
    range?: CommentRange,
  ) => void;
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
  attribute: ColorAttribute,
): string | null | "mixed" {
  const { from, to } = editor.state.selection;
  let observed: string | null = null;
  let hasObserved = false;
  let mixed = false;

  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const mark = node.marks.find(
      (candidate) => candidate.type.name === "notionSpan",
    );
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
  let hasText = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText) hasText = true;
    return !hasText;
  });
  return hasText;
}

export function setSelectionNotionSpanAttribute(
  editor: Editor,
  attribute: ColorAttribute,
  value: string | null,
) {
  const { state } = editor;
  const { from, to } = state.selection;
  const markType = state.schema.marks.notionSpan;
  if (!markType || from === to) return false;

  const transaction = state.tr;
  state.doc.nodesBetween(from, to, (node, position) => {
    if (!node.isText) return;
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

export function BubbleToolbar({ editor, onComment }: BubbleToolbarProps) {
  const t = useT();
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
    const syncTextStyle = () => {
      setTextStyle(activeTextStyle(editor));
      setColorRevision((revision) => revision + 1);
      const { from, to } = editor.state.selection;
      if (from !== to) {
        textStyleSelection.current = { from, to };
        colorSelection.current = { from, to };
      }
    };
    editor.on("selectionUpdate", syncTextStyle);
    editor.on("transaction", syncTextStyle);
    syncTextStyle();
    return () => {
      editor.off("selectionUpdate", syncTextStyle);
      editor.off("transaction", syncTextStyle);
    };
  }, [editor]);

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
    const chain = editor.chain();
    if (textStyleSelection.current) {
      chain.setTextSelection(textStyleSelection.current);
    }
    if (style === "paragraph") {
      chain.setParagraph().focus().run();
    } else {
      chain.setHeading({ level: style }).focus().run();
    }
    textStyleApplied.current = true;
    setTextStyle(style);
    setTextStyleOpen(false);
  };

  const applyColor = (attribute: ColorAttribute, value: string | null) => {
    if (colorSelection.current) {
      editor.commands.setTextSelection(colorSelection.current);
    }
    if (!setSelectionNotionSpanAttribute(editor, attribute, value)) return;
    if (value) setRecentColor({ attribute, value });
    colorApplied.current = true;
    setColorOpen(false);
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
          "relative flex size-8 items-center justify-center rounded-md border border-border bg-background text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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

  const handleSetLink = () => {
    if (linkUrl.trim()) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: linkUrl.trim() })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    }
    setShowLinkInput(false);
    setLinkUrl("");
  };

  const toggleLink = () => {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    openLinkInput();
  };

  const items = [
    { type: "text-style" as const },
    ...(selectionHasColorableText(
      editor.state,
      editor.state.selection.from,
      editor.state.selection.to,
    )
      ? [{ type: "color" as const }]
      : []),
    { type: "divider" as const },
    {
      icon: IconBold,
      title: t("editor.bold"),
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: () => editor.isActive("bold"),
    },
    {
      icon: IconItalic,
      title: t("editor.italic"),
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: () => editor.isActive("italic"),
    },
    {
      icon: IconStrikethrough,
      title: t("editor.strikethrough"),
      action: () => editor.chain().focus().toggleStrike().run(),
      isActive: () => editor.isActive("strike"),
    },
    {
      icon: IconCode,
      title: t("editor.code"),
      action: () => editor.chain().focus().toggleCode().run(),
      isActive: () => editor.isActive("code"),
    },
    { type: "divider" as const },
    {
      icon: IconLink,
      title: t("editor.link"),
      action: toggleLink,
      isActive: () => editor.isActive("link"),
    },
    ...(onComment
      ? [
          { type: "divider" as const },
          {
            icon: IconMessageCircle,
            title: t("editor.comment"),
            action: () => {
              const { from, to } = editor.state.selection;
              const text = editor.state.doc.textBetween(from, to, " ");
              if (!text.trim()) return;
              // Capture a robust anchor (quote + surrounding context + offset)
              // for the exact selection before we collapse it.
              const anchor = captureAnchor(editor.state.doc, from, to);
              // Get the Y position of the selection relative to the scroll container
              const coords = editor.view.coordsAtPos(from);
              const scrollContainer = editor.view.dom.closest(
                ".flex-1.min-h-0.overflow-auto",
              );
              const containerTop = scrollContainer
                ? scrollContainer.getBoundingClientRect().top
                : 0;
              const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
              const offsetTop = coords.top - containerTop + scrollTop;
              // Collapse the selection so the bubble toolbar hides — the pending
              // highlight (rendered by the CommentHighlight plugin) keeps the
              // range visible while the comment is composed.
              editor.commands.setTextSelection(from);
              onComment(text.trim(), offsetTop, anchor, { from, to });
            },
            isActive: () => false,
          },
        ]
      : []),
  ];

  return (
    <BubbleMenu
      editor={editor}
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
              if (e.key === "Escape") {
                setShowLinkInput(false);
                setLinkUrl("");
              }
            }}
            className="bg-transparent border-none outline-none text-popover-foreground text-sm w-40 sm:w-48 px-1 py-1 placeholder:text-muted-foreground"
          />
          <button
            onClick={handleSetLink}
            className="text-xs text-primary hover:text-primary/80 px-2 py-1.5 font-medium"
          >
            {t("editor.apply")}
          </button>
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
              return (
                <Popover
                  key="text-style"
                  open={textStyleOpen}
                  onOpenChange={(open) => {
                    if (open) {
                      textStyleApplied.current = false;
                      restoreEditorFocusOnClose.current = false;
                      const { from, to } = editor.state.selection;
                      if (from !== to)
                        textStyleSelection.current = { from, to };
                    }
                    setTextStyleOpen(open);
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${t("editor.slash.turnInto")}: ${selectedTextStyle.label}`}
                      className="flex h-8 min-w-14 items-center justify-between gap-1 rounded px-2 text-sm font-medium text-popover-foreground/85 hover:bg-accent hover:text-accent-foreground"
                    >
                      <span>{selectedTextStyle.shortLabel}</span>
                      <IconChevronDown size={14} strokeWidth={2} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    portalled={false}
                    align="start"
                    sideOffset={24}
                    className="w-44 p-1"
                    onEscapeKeyDown={() => {
                      restoreEditorFocusOnClose.current = true;
                      window.setTimeout(() => editor.commands.focus(), 0);
                    }}
                    onCloseAutoFocus={(event) => {
                      if (
                        textStyleApplied.current ||
                        restoreEditorFocusOnClose.current
                      ) {
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
                              "flex h-8 w-full items-center gap-2 rounded px-2 text-left text-sm",
                              isSelected
                                ? "bg-accent text-accent-foreground"
                                : "text-popover-foreground hover:bg-accent hover:text-accent-foreground",
                            )}
                          >
                            <span className="w-6 shrink-0 text-xs font-semibold text-muted-foreground">
                              {style.menuLabel}
                            </span>
                            <span className="flex-1">{style.label}</span>
                            {isSelected ? (
                              <IconCheck size={15} strokeWidth={2.25} />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              );
            }
            if ("type" in item && item.type === "color") {
              return (
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
                  </PopoverTrigger>
                  <PopoverContent
                    portalled={false}
                    align="start"
                    sideOffset={24}
                    className="w-52 p-2"
                    onEscapeKeyDown={() => {
                      restoreEditorFocusOnClose.current = true;
                      window.setTimeout(() => editor.commands.focus(), 0);
                    }}
                    onCloseAutoFocus={(event) => {
                      if (
                        colorApplied.current ||
                        restoreEditorFocusOnClose.current
                      ) {
                        event.preventDefault();
                      }
                      if (restoreEditorFocusOnClose.current) {
                        editor.commands.focus();
                      }
                      colorApplied.current = false;
                      restoreEditorFocusOnClose.current = false;
                    }}
                  >
                    {recentColor ? (
                      <div className="mb-2">
                        <div className="mb-1 text-xs font-medium text-muted-foreground">
                          {t("editor.color.recentlyUsed")}
                        </div>
                        <div role="menu">
                          {renderColorChoice(
                            recentColor.attribute,
                            recentColor.value,
                          )}
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
                        {COLOR_NAMES.map((name) =>
                          renderColorChoice("color", name),
                        )}
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
                  </PopoverContent>
                </Popover>
              );
            }
            const {
              icon: Icon,
              title,
              action,
              isActive,
            } = item as {
              icon: React.ElementType;
              title: string;
              action: () => void;
              isActive: () => boolean;
            };
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
