import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  IconBold,
  IconItalic,
  IconUnderline,
  IconStrikethrough,
  IconLink,
  IconPalette,
  IconCheck,
  IconX,
} from "@tabler/icons-react";

interface BlockBubbleMenuProps {
  /** The element currently in contentEditable mode. Menu only shows while selection is inside it. */
  editingEl: HTMLElement | null;
  /** Called when formatting changes, so the parent can persist the updated HTML. */
  onChange?: () => void;
}

interface Position {
  top: number;
  left: number;
}

/** Preset palette used by the color picker. */
const COLORS = [
  "#FFFFFF",
  "#E5E7EB",
  "#9CA3AF",
  "#000000",
  "#00E5FF",
  "#609FF8",
  "#A78BFA",
  "#F472B6",
  "#F59E0B",
  "#10B981",
  "#EF4444",
];

/**
 * Floating formatting toolbar for contentEditable text blocks. Shows on
 * non-empty selection inside the editing element and applies inline
 * formatting (bold, italic, underline, strike, link, color) directly to
 * the DOM. Designed to work with the in-place per-block editing in
 * SlideEditor — it never mutates anything outside the editing element.
 */
export function BlockBubbleMenu({ editingEl, onChange }: BlockBubbleMenuProps) {
  const [pos, setPos] = useState<Position | null>(null);
  const [showColors, setShowColors] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const savedRangeRef = useRef<Range | null>(null);

  // Hide menu when the editing element changes
  useEffect(() => {
    setPos(null);
    setShowColors(false);
    setShowLinkInput(false);
  }, [editingEl]);

  // Track selection and position the menu
  useEffect(() => {
    if (!editingEl) return;

    const updatePosition = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setPos(null);
        return;
      }
      const range = sel.getRangeAt(0);
      // Only show if selection is inside the editing element
      if (!editingEl.contains(range.commonAncestorContainer)) {
        setPos(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setPos(null);
        return;
      }
      savedRangeRef.current = range.cloneRange();
      setPos({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
    };

    document.addEventListener("selectionchange", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    updatePosition();

    return () => {
      document.removeEventListener("selectionchange", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [editingEl]);

  if (!editingEl || !pos) return null;

  /** Restore the saved selection before running a command (buttons steal focus). */
  const restoreSelection = () => {
    const range = savedRangeRef.current;
    if (!range) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    editingEl.focus();
    return true;
  };

  const runCommand = (cmd: string, value?: string) => {
    if (!restoreSelection()) return;
    // execCommand is deprecated but still the simplest way to apply
    // inline formatting inside a contentEditable region. We scope all
    // commands to the editing element by restoring its selection first.
    document.execCommand(cmd, false, value);
    onChange?.();
  };

  const applyColor = (color: string) => {
    runCommand("foreColor", color);
    setShowColors(false);
  };

  const applyLink = () => {
    if (!linkValue.trim()) return;
    const href = linkValue.startsWith("http")
      ? linkValue
      : `https://${linkValue}`;
    runCommand("createLink", href);
    setShowLinkInput(false);
    setLinkValue("");
  };

  const removeLink = () => {
    runCommand("unlink");
    setShowLinkInput(false);
    setLinkValue("");
  };

  return createPortal(
    <div
      data-block-bubble-menu="true"
      className="fixed z-[60] -translate-x-1/2 -translate-y-full flex items-center gap-0.5 p-1 rounded-lg bg-popover border border-border shadow-2xl shadow-black/60"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => {
        // Prevent blur on the editing element when clicking menu buttons
        e.preventDefault();
      }}
    >
      <ToolbarButton
        icon={IconBold}
        title="Bold (Cmd+B)"
        onClick={() => runCommand("bold")}
      />
      <ToolbarButton
        icon={IconItalic}
        title="Italic (Cmd+I)"
        onClick={() => runCommand("italic")}
      />
      <ToolbarButton
        icon={IconUnderline}
        title="Underline (Cmd+U)"
        onClick={() => runCommand("underline")}
      />
      <ToolbarButton
        icon={IconStrikethrough}
        title="Strikethrough"
        onClick={() => runCommand("strikeThrough")}
      />
      <div className="w-px h-4 bg-border mx-0.5" />
      <div className="relative">
        <ToolbarButton
          icon={IconPalette}
          title="Color"
          onClick={() => {
            setShowColors((v) => !v);
            setShowLinkInput(false);
          }}
          active={showColors}
        />
        {showColors && (
          <div className="absolute top-full left-0 mt-1 p-3 rounded-lg bg-popover border border-border shadow-2xl shadow-black/60 grid grid-cols-6 gap-2 w-max">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyColor(c)}
                className="w-7 h-7 rounded-md border border-foreground/25 hover:scale-110 transition-transform"
                style={{ background: c }}
                title={c}
                aria-label={`Set color ${c}`}
              />
            ))}
          </div>
        )}
      </div>
      <ToolbarButton
        icon={IconLink}
        title="Link"
        onClick={() => {
          setShowLinkInput((v) => !v);
          setShowColors(false);
        }}
        active={showLinkInput}
      />
      {showLinkInput && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 flex items-center gap-1 p-1 rounded-lg bg-popover border border-border shadow-2xl shadow-black/60">
          <input
            type="text"
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setShowLinkInput(false);
              }
            }}
            placeholder="Paste URL"
            className="px-2 py-1 text-xs bg-muted rounded text-foreground outline-none border border-border focus:border-ring w-40"
            autoFocus
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={applyLink}
            className="p-1 rounded hover:bg-accent text-[#609FF8]"
            title="Apply"
          >
            <IconCheck className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={removeLink}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
            title="Remove link"
          >
            <IconX className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

function ToolbarButton({
  icon: Icon,
  title,
  onClick,
  active,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? "bg-[#609FF8]/20 text-[#609FF8]"
          : "text-foreground/80 hover:bg-accent hover:text-foreground"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}
