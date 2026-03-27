import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link,
  Wand2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
interface ComposeBubbleToolbarProps {
  editor: Editor;
  onFlush: () => Promise<unknown> | undefined;
  isGenerating: boolean;
  sendToAgent: (opts: {
    message: string;
    context?: string;
    submit?: boolean;
  }) => void;
}

export function ComposeBubbleToolbar({
  editor,
  onFlush,
  isGenerating,
  sendToAgent,
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

    sendToAgent({
      message: aiPrompt.trim(),
      context: `The user has selected specific text in their email draft and wants you to edit ONLY that selected portion. You MUST:\n1. Read the full draft from application-state/compose.json\n2. Find and replace ONLY the selected text (shown below) with your edited version based on the user's instruction\n3. Preserve ALL other content exactly as-is — subject, recipients, and every other part of the body that was not selected\n4. Write the updated draft back to application-state/compose.json\n\nSelected text to edit:\n"${selectedText}"`,
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
      shouldShow={({ editor, state, from, to }) => {
        if (!editor.isFocused) return false;
        if (from === to) return false;
        // Hide for node selections (images, etc.)
        const { selection } = state;
        if ((selection as any).node) return false;
        return true;
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
      ) : showAiInput || isGenerating ? (
        <div
          className="flex items-center gap-1 px-1"
          onMouseDown={(e) => e.preventDefault()}
        >
          {isGenerating ? (
            <>
              <Loader2 size={14} className="animate-spin text-gray-400" />
              <span className="text-xs text-gray-400 px-1">Generating…</span>
            </>
          ) : (
            <>
              <textarea
                autoFocus
                placeholder="e.g. make more formal..."
                value={aiPrompt}
                rows={2}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    void handleAiAssist();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setShowAiInput(false);
                    setAiPrompt("");
                  }
                }}
                className="bg-transparent border-none outline-none text-white text-sm w-52 px-1 py-0.5 placeholder:text-gray-400 resize-none leading-snug"
              />
              <button
                onClick={() => void handleAiAssist()}
                title="Generate (⌘Enter)"
                className="text-xs text-blue-400 hover:text-blue-300 px-1.5 py-0.5 font-medium shrink-0 self-end pb-1"
              >
                Generate
              </button>
            </>
          )}
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
            <Wand2 size={14} strokeWidth={2.5} />
          </button>
        </div>
      )}
    </BubbleMenu>
  );
}
