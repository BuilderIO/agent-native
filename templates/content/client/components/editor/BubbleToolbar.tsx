import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface BubbleToolbarProps {
  editor: Editor;
  onGenerateImage?: (selectedText: string) => void;
}

export function BubbleToolbar({ editor, onGenerateImage }: BubbleToolbarProps) {
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

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
      icon: Bold,
      title: "Bold",
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: () => editor.isActive("bold"),
    },
    {
      icon: Italic,
      title: "Italic",
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: () => editor.isActive("italic"),
    },
    {
      icon: Strikethrough,
      title: "Strikethrough",
      action: () => editor.chain().focus().toggleStrike().run(),
      isActive: () => editor.isActive("strike"),
    },
    {
      icon: Code,
      title: "Code",
      action: () => editor.chain().focus().toggleCode().run(),
      isActive: () => editor.isActive("code"),
    },
    { type: "divider" as const },
    {
      icon: Heading1,
      title: "Heading 1",
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: () => editor.isActive("heading", { level: 1 }),
    },
    {
      icon: Heading2,
      title: "Heading 2",
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: () => editor.isActive("heading", { level: 2 }),
    },
    {
      icon: Heading3,
      title: "Heading 3",
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: () => editor.isActive("heading", { level: 3 }),
    },
    { type: "divider" as const },
    {
      icon: Link,
      title: "Link",
      action: toggleLink,
      isActive: () => editor.isActive("link"),
    },
  ];

  const handleGenerateImage = () => {
    if (!onGenerateImage) return;
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, " ");
    if (text.trim()) {
      onGenerateImage(text.trim());
    }
  };

  return (
    <BubbleMenu
      editor={editor}
      className="bubble-toolbar"
      shouldShow={({ editor, state, from, to }) => {
        if (!editor.isFocused) return false;
        const isSelection = from !== to;
        return isSelection;
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
            placeholder="Paste link..."
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSetLink();
              if (e.key === "Escape") {
                setShowLinkInput(false);
                setLinkUrl("");
              }
            }}
            className="bg-transparent border-none outline-none text-white text-sm w-48 px-1 py-0.5 placeholder:text-gray-400"
          />
          <button
            onClick={handleSetLink}
            className="text-xs text-blue-400 hover:text-blue-300 px-1.5 py-0.5 font-medium"
          >
            Apply
          </button>
        </div>
      ) : (
        <div
          className="flex items-center gap-0.5"
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
              <button
                key={title}
                onClick={action}
                title={title}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  isActive()
                    ? "bg-gray-600 text-white"
                    : "text-gray-300 hover:bg-gray-700 hover:text-white",
                )}
              >
                <Icon size={14} strokeWidth={2.5} />
              </button>
            );
          })}
          {onGenerateImage && (
            <>
              <div className="w-px h-5 bg-gray-600 mx-0.5" />
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleGenerateImage();
                }}
                title="Generate Image"
                className="p-1.5 rounded transition-colors text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                <ImageIcon size={14} strokeWidth={2.5} />
              </button>
            </>
          )}
        </div>
      )}
    </BubbleMenu>
  );
}
