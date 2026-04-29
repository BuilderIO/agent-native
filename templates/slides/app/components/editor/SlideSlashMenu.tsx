import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { createPortal } from "react-dom";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import type { Editor } from "@tiptap/react";
import {
  IconH1,
  IconH2,
  IconH3,
  IconList,
  IconListNumbers,
  IconBlockquote,
  IconLetterT,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const SLASH_MENU_KEY = new PluginKey("slideSlashMenu");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyIcon = React.ComponentType<any>;

interface SlashCommand {
  title: string;
  description: string;
  icon: AnyIcon;
  command: (editor: Editor) => void;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    title: "Text",
    description: "Plain paragraph",
    icon: IconLetterT,
    command: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    title: "Heading 1",
    description: "Large slide heading",
    icon: IconH1,
    command: (editor) =>
      editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium heading",
    icon: IconH2,
    command: (editor) =>
      editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Small heading",
    icon: IconH3,
    command: (editor) =>
      editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Bullet List",
    description: "Unordered list",
    icon: IconList,
    command: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: "Numbered List",
    description: "Ordered list",
    icon: IconListNumbers,
    command: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: "Quote",
    description: "Blockquote",
    icon: IconBlockquote,
    command: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
];

interface SlashMenuUIProps {
  editor: Editor;
  position: { x: number; y: number } | null;
  query: string;
  onClose: () => void;
  onCommand: (cmd: SlashCommand) => void;
}

export const SlashMenuUI = forwardRef<
  { moveUp: () => void; moveDown: () => void; select: () => void },
  SlashMenuUIProps
>(({ editor, position, query, onClose, onCommand }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = SLASH_COMMANDS.filter(
    (cmd) =>
      !query ||
      cmd.title.toLowerCase().includes(query.toLowerCase()) ||
      cmd.description.toLowerCase().includes(query.toLowerCase()),
  );

  useImperativeHandle(ref, () => ({
    moveUp: () =>
      setSelectedIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1)),
    moveDown: () =>
      setSelectedIndex((i) => (i >= filtered.length - 1 ? 0 : i + 1)),
    select: () => {
      const cmd = filtered[selectedIndex];
      if (cmd) onCommand(cmd);
    },
  }));

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!position || filtered.length === 0) return null;

  return createPortal(
    <div
      data-slash-menu="true"
      className="fixed z-[9999] w-60 rounded-lg bg-popover border border-border shadow-2xl overflow-hidden py-1"
      style={{ top: position.y, left: position.x }}
    >
      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">
        Blocks
      </div>
      {filtered.map((cmd, i) => {
        const Icon = cmd.icon;
        return (
          <button
            key={cmd.title}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 text-left",
              i === selectedIndex
                ? "bg-accent text-foreground"
                : "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
            )}
            onMouseEnter={() => setSelectedIndex(i)}
            onClick={() => onCommand(cmd)}
          >
            <div className="w-7 h-7 rounded flex items-center justify-center bg-accent/50 shrink-0">
              <Icon size={14} stroke={2} />
            </div>
            <div>
              <div className="text-sm font-medium leading-tight">
                {cmd.title}
              </div>
              <div className="text-xs text-muted-foreground leading-tight">
                {cmd.description}
              </div>
            </div>
          </button>
        );
      })}
    </div>,
    document.body,
  );
});

SlashMenuUI.displayName = "SlashMenuUI";

/**
 * TipTap extension that fires a custom event when the user types / at the
 * start of a block so the host component can show a slash command menu.
 */
export const SlashCommandExtension = Extension.create({
  name: "slideSlashCommand",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: SLASH_MENU_KEY,
        props: {
          handleKeyDown: (view, event) => {
            // Let the host component's keydown listener handle navigation
            if (
              event.key === "ArrowUp" ||
              event.key === "ArrowDown" ||
              event.key === "Enter" ||
              event.key === "Escape"
            ) {
              // Capture open state BEFORE dispatching — the event listener may
              // call closeMenu() synchronously, flipping the flag to false.
              const wasOpen = (view.dom as any).__slashMenuOpen;

              // Dispatch so the React component can intercept
              const customEvent = new CustomEvent("slide-slash-nav", {
                detail: { key: event.key },
                bubbles: true,
              });
              view.dom.dispatchEvent(customEvent);

              // If the menu was open, swallow Arrow/Enter/Escape and stop
              // propagation so window-level listeners (e.g. SlideEditor's
              // Escape handler) don't also fire.
              if (wasOpen) {
                event.stopPropagation();
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});

/** Hook that manages slash command state for a TipTap editor */
export function useSlashMenu(editor: Editor | null) {
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [query, setQuery] = useState("");
  const menuRef = useRef<{
    moveUp: () => void;
    moveDown: () => void;
    select: () => void;
  }>(null);
  const slashPosRef = useRef<number | null>(null);

  const closeMenu = useCallback(() => {
    setMenuPosition(null);
    setQuery("");
    slashPosRef.current = null;
    if (editor?.view?.dom) {
      (editor.view.dom as any).__slashMenuOpen = false;
    }
  }, [editor]);

  const executeCommand = useCallback(
    (cmd: SlashCommand) => {
      if (!editor) return;
      // Capture position BEFORE closeMenu() nulls slashPosRef
      const slashPos = slashPosRef.current;
      const { from } = editor.state.selection;
      closeMenu();

      if (slashPos !== null) {
        // Delete the slash + any query text, then apply the block-type command.
        // Use requestAnimationFrame so the deleteRange transaction commits and
        // the editor's selection is stable before toggleHeading/etc. runs.
        editor.chain().focus().deleteRange({ from: slashPos, to: from }).run();
        requestAnimationFrame(() => cmd.command(editor));
      } else {
        cmd.command(editor);
      }
    },
    [editor, closeMenu],
  );

  useEffect(() => {
    if (!editor) return;

    const onUpdate = () => {
      const { state } = editor;
      const { selection } = state;
      const { $from } = selection;

      // Get text from start of block to cursor
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n");

      // Find slash position
      const slashIndex = textBefore.lastIndexOf("/");
      if (slashIndex === -1) {
        if (menuPosition) closeMenu();
        return;
      }

      // Only trigger if slash is recent (within 20 chars of end) and nothing before it except whitespace
      const beforeSlash = textBefore.slice(0, slashIndex);
      if (beforeSlash.trim().length > 0) {
        if (menuPosition) closeMenu();
        return;
      }

      const q = textBefore.slice(slashIndex + 1);
      // Don't show menu if query has spaces
      if (q.includes(" ")) {
        if (menuPosition) closeMenu();
        return;
      }

      setQuery(q);

      // Calculate menu position from the slash character position
      const slashAbsPos = $from.pos - $from.parentOffset + slashIndex;
      slashPosRef.current = slashAbsPos;

      // Get DOM position of the slash character
      try {
        const coords = editor.view.coordsAtPos(slashAbsPos + 1);
        const editorRect = editor.view.dom.getBoundingClientRect();

        // Position below the line
        setMenuPosition({
          x: Math.min(coords.left, window.innerWidth - 260),
          y: Math.min(coords.bottom + 4, window.innerHeight - 300),
        });
        (editor.view.dom as any).__slashMenuOpen = true;
      } catch {
        // coordsAtPos can fail if position is out of range
      }
    };

    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor, menuPosition, closeMenu]);

  // Handle keyboard navigation when menu is open
  useEffect(() => {
    if (!editor?.view?.dom) return;
    const dom = editor.view.dom;

    const onNav = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!menuPosition) return;

      if (detail.key === "ArrowUp") {
        e.preventDefault();
        menuRef.current?.moveUp();
      } else if (detail.key === "ArrowDown") {
        e.preventDefault();
        menuRef.current?.moveDown();
      } else if (detail.key === "Enter") {
        e.preventDefault();
        menuRef.current?.select();
      } else if (detail.key === "Escape") {
        // Delete the "/" and any query text before closing
        if (editor && slashPosRef.current !== null) {
          const { from } = editor.state.selection;
          editor
            .chain()
            .focus()
            .deleteRange({ from: slashPosRef.current, to: from })
            .run();
        }
        closeMenu();
      }
    };

    dom.addEventListener("slide-slash-nav", onNav);
    return () => dom.removeEventListener("slide-slash-nav", onNav);
  }, [editor, menuPosition, closeMenu]);

  // Close on click outside
  useEffect(() => {
    if (!menuPosition) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest('[data-slash-menu="true"]')) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuPosition, closeMenu]);

  return { menuPosition, query, menuRef, closeMenu, executeCommand };
}
