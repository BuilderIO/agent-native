import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import {
  IconBold,
  IconItalic,
  IconStrikethrough,
  IconCode,
  IconLink,
  IconH1,
  IconH2,
  IconH3,
  IconList,
  IconListNumbers,
} from "@tabler/icons-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyIcon = React.ComponentType<any>;

interface ButtonItem {
  type?: never;
  icon: AnyIcon;
  title: string;
  action: () => void;
  isActive: () => boolean;
}

interface DividerItem {
  type: "divider";
  icon?: never;
}

interface SlideBubbleMenuProps {
  editor: Editor;
}

export function SlideBubbleMenu({ editor }: SlideBubbleMenuProps) {
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

  const buttons: (ButtonItem | DividerItem)[] = [
    {
      icon: IconBold,
      title: "Bold",
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: () => editor.isActive("bold"),
    },
    {
      icon: IconItalic,
      title: "Italic",
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: () => editor.isActive("italic"),
    },
    {
      icon: IconStrikethrough,
      title: "Strikethrough",
      action: () => editor.chain().focus().toggleStrike().run(),
      isActive: () => editor.isActive("strike"),
    },
    {
      icon: IconCode,
      title: "Code",
      action: () => editor.chain().focus().toggleCode().run(),
      isActive: () => editor.isActive("code"),
    },
    { type: "divider" },
    {
      icon: IconH1,
      title: "Heading 1",
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: () => editor.isActive("heading", { level: 1 }),
    },
    {
      icon: IconH2,
      title: "Heading 2",
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: () => editor.isActive("heading", { level: 2 }),
    },
    {
      icon: IconH3,
      title: "Heading 3",
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: () => editor.isActive("heading", { level: 3 }),
    },
    { type: "divider" },
    {
      icon: IconList,
      title: "Bullet List",
      action: () => editor.chain().focus().toggleBulletList().run(),
      isActive: () => editor.isActive("bulletList"),
    },
    {
      icon: IconListNumbers,
      title: "Ordered List",
      action: () => editor.chain().focus().toggleOrderedList().run(),
      isActive: () => editor.isActive("orderedList"),
    },
    { type: "divider" },
    {
      icon: IconLink,
      title: "Link",
      action: toggleLink,
      isActive: () => editor.isActive("link"),
    },
  ];

  return (
    <BubbleMenu editor={editor}>
      <div className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-[#1c1c1c] border border-white/10 shadow-xl">
        {showLinkInput ? (
          <div className="flex items-center gap-1.5 px-1">
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSetLink();
                if (e.key === "Escape") {
                  setShowLinkInput(false);
                  setLinkUrl("");
                }
              }}
              placeholder="Paste URL..."
              className="w-48 bg-transparent text-white text-sm outline-none placeholder-white/30 border-b border-white/20 pb-0.5"
              autoFocus
            />
            <button
              onClick={handleSetLink}
              className="text-xs text-[#609FF8] hover:text-[#7AB2FA] font-medium"
            >
              Apply
            </button>
            <button
              onClick={() => {
                setShowLinkInput(false);
                setLinkUrl("");
              }}
              className="text-xs text-white/50 hover:text-white/80"
            >
              Cancel
            </button>
          </div>
        ) : (
          buttons.map((item, i) => {
            if (item.type === "divider") {
              return <div key={i} className="w-px h-4 bg-white/15 mx-0.5" />;
            }
            const btn = item as ButtonItem;
            const Icon = btn.icon;
            const active = btn.isActive() ?? false;
            return (
              <button
                key={i}
                title={btn.title}
                onClick={btn.action}
                className={cn(
                  "p-1.5 rounded",
                  active
                    ? "bg-white/20 text-white"
                    : "text-white/70 hover:text-white hover:bg-white/10",
                )}
              >
                <Icon size={14} stroke={2} />
              </button>
            );
          })
        )}
      </div>
    </BubbleMenu>
  );
}
