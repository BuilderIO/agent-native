import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEffect, useState, type CSSProperties } from "react";

import { cn } from "../utils.js";

/** A bubble-toolbar button or a divider. */
export type BubbleToolbarItem =
  | {
      /** Short label/glyph shown on the button. */
      label: string;
      /** Accessible/title text. */
      title: string;
      action: () => void;
      isActive: () => boolean;
      style?: CSSProperties;
    }
  | { type: "divider" };

/**
 * Builds the default selection-toolbar items (Plan's current set): bold,
 * italic, strike, code, headings 1-3, and a link toggle. `toggleLink` is
 * supplied by the toolbar so the link-editor input can be opened.
 */
export function buildDefaultBubbleItems(
  editor: Editor,
  toggleLink: () => void,
): BubbleToolbarItem[] {
  return [
    {
      label: "B",
      title: "Bold",
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: () => editor.isActive("bold"),
      style: { fontWeight: 700 },
    },
    {
      label: "I",
      title: "Italic",
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: () => editor.isActive("italic"),
      style: { fontStyle: "italic" },
    },
    {
      label: "S",
      title: "Strikethrough",
      action: () => editor.chain().focus().toggleStrike().run(),
      isActive: () => editor.isActive("strike"),
      style: { textDecoration: "line-through" },
    },
    {
      label: "<>",
      title: "Code",
      action: () => editor.chain().focus().toggleCode().run(),
      isActive: () => editor.isActive("code"),
      style: { fontFamily: "monospace", fontSize: 11 },
    },
    { type: "divider" },
    {
      label: "H1",
      title: "Heading 1",
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: () => editor.isActive("heading", { level: 1 }),
    },
    {
      label: "H2",
      title: "Heading 2",
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: () => editor.isActive("heading", { level: 2 }),
    },
    {
      label: "H3",
      title: "Heading 3",
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: () => editor.isActive("heading", { level: 3 }),
    },
    { type: "divider" },
    {
      label: "Link",
      title: "Link",
      action: toggleLink,
      isActive: () => editor.isActive("link"),
    },
  ];
}

export interface BubbleToolbarProps {
  editor: Editor;
  /**
   * Custom item builder. Receives the editor and the `toggleLink` helper (so a
   * custom set can still open the built-in link editor). Defaults to
   * {@link buildDefaultBubbleItems}.
   */
  buildItems?: (editor: Editor, toggleLink: () => void) => BubbleToolbarItem[];
}

/**
 * The shared floating selection toolbar. Tracks the current text selection and
 * positions a fixed toolbar above it, with an inline link editor. Extracted
 * from the inline plan toolbar so embedders share one implementation; apps swap
 * the item set via `buildItems`.
 */
export function BubbleToolbar({
  editor,
  buildItems = buildDefaultBubbleItems,
}: BubbleToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  useEffect(() => {
    const update = () => {
      const selectionState = editor.state.selection;
      const { from, to } = selectionState;
      const selection = window.getSelection();
      const selectionInsideEditor =
        !!selection?.anchorNode &&
        !!selection.focusNode &&
        editor.view.dom.contains(selection.anchorNode) &&
        editor.view.dom.contains(selection.focusNode);
      if (
        !(selectionState instanceof TextSelection) ||
        from === to ||
        !selectionInsideEditor
      ) {
        setVisible(false);
        return;
      }
      if (!selection || selection.rangeCount === 0) {
        setVisible(false);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setVisible(false);
        return;
      }
      setCoords({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
      setVisible(true);
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    document.addEventListener("selectionchange", update);
    const onBlur = () => {
      setTimeout(() => {
        if (!editor.isFocused) setVisible(false);
      }, 140);
    };
    editor.on("blur", onBlur);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      document.removeEventListener("selectionchange", update);
      editor.off("blur", onBlur);
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
    setLinkUrl(editor.getAttributes("link").href || "");
    setShowLinkInput(true);
  };

  const items = buildItems(editor, toggleLink);

  if (!visible) return null;

  return (
    <div
      className="an-rich-md-bubble-toolbar"
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        transform: "translate(-50%, -100%)",
      }}
      onMouseDown={(event) => event.preventDefault()}
      data-plan-interactive
    >
      {showLinkInput ? (
        <div className="an-rich-md-link-editor">
          <input
            autoFocus
            type="url"
            placeholder="Paste link..."
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSetLink();
              if (event.key === "Escape") {
                setShowLinkInput(false);
                setLinkUrl("");
              }
            }}
          />
          <button type="button" onClick={handleSetLink}>
            Apply
          </button>
        </div>
      ) : (
        <div className="an-rich-md-bubble-items">
          {items.map((item, index) => {
            if ("type" in item) {
              return (
                <span
                  key={`divider-${index}`}
                  className="an-rich-md-bubble-divider"
                />
              );
            }
            return (
              <button
                key={item.title}
                type="button"
                title={item.title}
                className={cn(
                  "an-rich-md-bubble-button",
                  item.isActive() && "an-rich-md-bubble-button--active",
                )}
                style={item.style}
                onClick={item.action}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
