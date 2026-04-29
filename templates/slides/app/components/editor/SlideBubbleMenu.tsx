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
  IconMessageCircle,
  IconPalette,
  IconX,
  IconPlus,
  IconCheck,
  IconPencil,
} from "@tabler/icons-react";
import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  copiedStyle,
  setCopiedStyle,
  getBrandPalette,
  setBrandPalette,
  type CopiedStyle,
} from "./style-clipboard";

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
  onComment?: (quotedText: string) => void;
}

/** Hex color input with validation */
function HexInput({
  onAdd,
  onCancel,
}: {
  onAdd: (hex: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState("");

  const isValid = /^#[0-9A-Fa-f]{6}$/.test(val);

  return (
    <div className="flex items-center gap-1 mt-1">
      <div
        className="w-4 h-4 rounded-sm flex-shrink-0 border border-border"
        style={{ background: isValid ? val : "transparent" }}
      />
      <input
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && isValid) onAdd(val);
          if (e.key === "Escape") onCancel();
        }}
        placeholder="#000000"
        maxLength={7}
        className="flex-1 bg-transparent text-foreground text-xs outline-none placeholder-muted-foreground/70 border-b border-border pb-0.5 w-20"
        autoFocus
      />
      {isValid && (
        <button
          onClick={() => onAdd(val)}
          className="text-[#00E5FF] hover:text-foreground"
        >
          <IconCheck size={12} />
        </button>
      )}
      <button
        onClick={onCancel}
        className="text-muted-foreground hover:text-foreground"
      >
        <IconX size={12} />
      </button>
    </div>
  );
}

/** Color palette popover for picking and managing brand colors */
function ColorPicker({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [palette, setPalette] = useState<string[]>(getBrandPalette);
  const [editMode, setEditMode] = useState(false);
  const [addingColor, setAddingColor] = useState(false);
  const currentColor =
    (editor.getAttributes("textStyle").color as string | undefined) ?? null;

  const applyColor = (color: string) => {
    editor.chain().focus().setColor(color).run();
    onClose();
  };

  const removeColor = () => {
    editor.chain().focus().unsetColor().run();
    onClose();
  };

  const addTopalette = (hex: string) => {
    const next = palette.includes(hex) ? palette : [...palette, hex];
    setPalette(next);
    setBrandPalette(next);
    setAddingColor(false);
    applyColor(hex);
  };

  const removeFromPalette = (hex: string) => {
    const next = palette.filter((c) => c !== hex);
    setPalette(next);
    setBrandPalette(next);
  };

  return (
    <div className="w-[180px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Brand Colors
        </span>
        <button
          onClick={() => setEditMode((v) => !v)}
          className={cn(
            "p-0.5 rounded",
            editMode
              ? "text-[#00E5FF]"
              : "text-muted-foreground hover:text-foreground",
          )}
          title="Edit palette"
        >
          <IconPencil size={11} />
        </button>
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {palette.map((color) => (
          <div key={color} className="relative group">
            <button
              title={color}
              onClick={() => (editMode ? undefined : applyColor(color))}
              className={cn(
                "w-6 h-6 rounded-md border transition-transform",
                currentColor?.toLowerCase() === color.toLowerCase()
                  ? "border-foreground scale-110"
                  : "border-border hover:scale-110",
              )}
              style={{ background: color }}
            />
            {editMode && (
              <button
                onClick={() => removeFromPalette(color)}
                className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-popover border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/50"
              >
                <IconX size={8} />
              </button>
            )}
          </div>
        ))}

        {/* Add color button */}
        {!addingColor && (
          <button
            onClick={() => setAddingColor(true)}
            className="w-6 h-6 rounded-md border border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/40"
            title="Add color"
          >
            <IconPlus size={10} />
          </button>
        )}
      </div>

      {addingColor && (
        <HexInput onAdd={addTopalette} onCancel={() => setAddingColor(false)} />
      )}

      <div className="mt-2 pt-2 border-t border-border">
        <button
          onClick={removeColor}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground w-full"
        >
          <IconX size={11} />
          Remove color
        </button>
      </div>
    </div>
  );
}

export function SlideBubbleMenu({ editor, onComment }: SlideBubbleMenuProps) {
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [colorOpen, setColorOpen] = useState(false);

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

  const currentColor =
    (editor.getAttributes("textStyle").color as string | undefined) ?? null;

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

  // Comment button — only when onComment is provided
  const hasCommentBtn = !!onComment;

  return (
    <BubbleMenu editor={editor}>
      <div
        data-bubble-menu="true"
        className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-popover border border-border shadow-xl"
      >
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
              className="w-48 bg-transparent text-foreground text-sm outline-none placeholder-muted-foreground/70 border-b border-border pb-0.5"
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
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            {buttons.map((item, i) => {
              if (item.type === "divider") {
                return <div key={i} className="w-px h-4 bg-border mx-0.5" />;
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
                      ? "bg-accent text-foreground"
                      : "text-foreground/80 hover:text-foreground hover:bg-accent",
                  )}
                >
                  <Icon size={14} stroke={2} />
                </button>
              );
            })}

            {/* Color picker */}
            <div className="w-px h-4 bg-border mx-0.5" />
            <Popover open={colorOpen} onOpenChange={setColorOpen}>
              <PopoverTrigger asChild>
                <button
                  title="Text color"
                  className={cn(
                    "p-1.5 rounded relative",
                    colorOpen
                      ? "bg-accent text-foreground"
                      : "text-foreground/80 hover:text-foreground hover:bg-accent",
                  )}
                >
                  <IconPalette size={14} stroke={2} />
                  {/* Color indicator underline */}
                  <div
                    className="absolute bottom-0.5 left-1.5 right-1.5 h-0.5 rounded-full"
                    style={{
                      background: currentColor ?? "transparent",
                      border: currentColor
                        ? "none"
                        : "1px solid hsl(var(--border))",
                    }}
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="end"
                sideOffset={6}
                className="bg-popover border-border text-foreground p-3 w-auto"
              >
                <ColorPicker
                  editor={editor}
                  onClose={() => setColorOpen(false)}
                />
                <div className="mt-2 pt-2 border-t border-border flex gap-2 text-[10px] text-muted-foreground">
                  <span>⌘⌥C copy style</span>
                  <span>⌘⌥V paste style</span>
                </div>
              </PopoverContent>
            </Popover>

            {hasCommentBtn && (
              <>
                <div className="w-px h-4 bg-border mx-0.5" />
                <button
                  title="Comment"
                  onClick={() => {
                    const { from, to } = editor.state.selection;
                    const quotedText = editor.state.doc.textBetween(
                      from,
                      to,
                      " ",
                    );
                    onComment!(quotedText);
                  }}
                  className="p-1.5 rounded text-foreground/80 hover:text-foreground hover:bg-accent"
                >
                  <IconMessageCircle size={14} stroke={2} />
                </button>
              </>
            )}
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
