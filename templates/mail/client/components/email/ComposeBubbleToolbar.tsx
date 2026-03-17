import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { sendToAgentChat } from "@agent-native/core";

interface ComposeBubbleToolbarProps {
  editor: Editor;
  onFlush: () => Promise<unknown> | undefined;
}

export function ComposeBubbleToolbar({
  editor,
  onFlush,
}: ComposeBubbleToolbarProps) {
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [showAiInput, setShowAiInput] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

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
    setShowAiInput(false);
  };

  const handleAiAssist = async () => {
    if (!aiPrompt.trim()) return;

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ");

    await onFlush();

    sendToAgentChat({
      message: aiPrompt.trim(),
      context: `The user has selected text in their email draft and wants you to modify it. The current draft is saved in application-state/compose.json. You can read and update it directly.\n\nSelected text:\n"${selectedText}"`,
      submit: true,
    });

    setAiPrompt("");
    setShowAiInput(false);
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
      icon: Link,
      title: "Link",
      action: toggleLink,
      isActive: () => editor.isActive("link"),
    },
  ];

  return (
    <BubbleMenu
      editor={editor}
      className="bubble-toolbar"
      shouldShow={({ editor, from, to }) => {
        if (!editor.isFocused) return false;
        return from !== to;
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
      ) : showAiInput ? (
        <div
          className="flex items-center gap-1 px-1"
          onMouseDown={(e) => e.preventDefault()}
        >
          <input
            autoFocus
            type="text"
            placeholder="e.g. make more formal..."
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAiAssist();
              }
              if (e.key === "Escape") {
                setShowAiInput(false);
                setAiPrompt("");
              }
            }}
            className="bg-transparent border-none outline-none text-white text-sm w-52 px-1 py-0.5 placeholder:text-gray-400"
          />
          <button
            onClick={() => void handleAiAssist()}
            className="text-xs text-blue-400 hover:text-blue-300 px-1.5 py-0.5 font-medium"
          >
            Send
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
          <div className="w-px h-5 bg-gray-600 mx-0.5" />
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowAiInput(true);
              setShowLinkInput(false);
            }}
            title="AI Assist"
            className="p-1.5 rounded transition-colors text-gray-300 hover:bg-gray-700 hover:text-white"
          >
            <Sparkles size={14} strokeWidth={2.5} />
          </button>
        </div>
      )}
    </BubbleMenu>
  );
}
