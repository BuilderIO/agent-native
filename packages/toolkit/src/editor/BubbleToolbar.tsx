import { AllSelection, TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEffect, useState, type CSSProperties } from "react";

import { cn } from "../utils.js";

export type BubbleToolbarItem =
  | {
      label: string;
      title: string;
      action: () => void;
      isActive: () => boolean;
      style?: CSSProperties;
    }
  | { type: "divider" };

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
  buildItems?: (editor: Editor, toggleLink: () => void) => BubbleToolbarItem[];
}

export function BubbleToolbar({
  editor,
  buildItems = buildDefaultBubbleItems,
}: BubbleToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");

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
        (!(selectionState instanceof TextSelection) &&
          !(selectionState instanceof AllSelection)) ||
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

  const closeLinkEditor = () => {
    setShowLinkInput(false);
    setLinkUrl("");
    setLinkText("");
  };

  const handleSetLink = () => {
    const url = linkUrl.trim();
    const text = linkText.trim();
    const { from, to } = editor.state.selection;
    const current = editor.state.doc.textBetween(from, to);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (text && text !== current) {
      chain
        .insertContent({
          type: "text",
          text,
          ...(url ? { marks: [{ type: "link", attrs: { href: url } }] } : {}),
        })
        .run();
    } else if (url) {
      chain.setLink({ href: url }).run();
    } else {
      chain.unsetLink().run();
    }
    closeLinkEditor();
  };

  const handleRemoveLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    closeLinkEditor();
  };

  const toggleLink = () => {
    const { from, to } = editor.state.selection;
    setLinkUrl(
      editor.isActive("link") ? editor.getAttributes("link").href || "" : "",
    );
    setLinkText(editor.state.doc.textBetween(from, to));
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
            aria-label="Text"
            placeholder="Link text"
            value={linkText}
            onChange={(event) => setLinkText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSetLink();
              if (event.key === "Escape") closeLinkEditor();
            }}
          />
          <input
            autoFocus
            aria-label="URL"
            type="url"
            placeholder="https://example.com"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSetLink();
              if (event.key === "Escape") closeLinkEditor();
            }}
          />
          {editor.isActive("link") && (
            <button type="button" onClick={handleRemoveLink}>
              Remove
            </button>
          )}
          <button type="button" onClick={closeLinkEditor}>
            Cancel
          </button>
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
