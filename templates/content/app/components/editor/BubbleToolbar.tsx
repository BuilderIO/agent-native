import { useT } from "@agent-native/core/client";
import {
  IconBold,
  IconItalic,
  IconStrikethrough,
  IconCode,
  IconLink,
  IconMessageCircle,
  IconH1,
  IconH2,
  IconH3,
  IconH4,
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
import { useEffect, useState } from "react";

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
  "localMdxComponent",
]);

type SelectionFillRange = {
  from: number;
  to: number;
};

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

export function BubbleToolbar({ editor, onComment }: BubbleToolbarProps) {
  const t = useT();
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

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
  }, [editor]);

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
    const previousUrl = editor.getAttributes("link").href || "";
    setLinkUrl(previousUrl);
    setShowLinkInput(true);
  };

  const items = [
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
      icon: IconH1,
      title: t("editor.heading1"),
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: () => editor.isActive("heading", { level: 1 }),
    },
    {
      icon: IconH2,
      title: t("editor.heading2"),
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: () => editor.isActive("heading", { level: 2 }),
    },
    {
      icon: IconH3,
      title: t("editor.heading3"),
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: () => editor.isActive("heading", { level: 3 }),
    },
    {
      icon: IconH4,
      title: t("editor.heading4"),
      action: () => editor.chain().focus().toggleHeading({ level: 4 }).run(),
      isActive: () => editor.isActive("heading", { level: 4 }),
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
      shouldShow={({ editor, state, from, to }) => {
        if (!editor.isFocused) return false;
        const isSelection = from !== to;
        if (!isSelection) return false;
        return !selectionIncludesBubbleToolbarExcludedNode(state, from, to);
      }}
    >
      {showLinkInput ? (
        <div
          className="flex items-center gap-1 px-1"
          onMouseDown={(e) => e.preventDefault()}
        >
          <input
            autoFocus
            type="url"
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
            className="bg-transparent border-none outline-none text-white text-sm w-40 sm:w-48 px-1 py-1 placeholder:text-gray-400"
          />
          <button
            onClick={handleSetLink}
            className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1.5 font-medium"
          >
            {t("editor.apply")}
          </button>
        </div>
      ) : (
        <div
          className="flex items-center gap-0.5 overflow-x-auto"
          onMouseDown={(e) => e.preventDefault()}
        >
          {items.map((item, i) => {
            if ("type" in item && item.type === "divider") {
              return (
                <div key={`d-${i}`} className="w-px h-5 bg-gray-600 mx-0.5" />
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
                    onClick={action}
                    className={cn(
                      "p-2 rounded",
                      isActive()
                        ? "bg-gray-600 text-white"
                        : "text-gray-300 hover:bg-gray-700 hover:text-white",
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
