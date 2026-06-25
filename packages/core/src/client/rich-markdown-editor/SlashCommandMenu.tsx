import type { Editor } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { cn } from "../utils.js";
import { pickAndInsertImage, type ImageUploadFn } from "./ImageExtension.js";

/** A single slash-menu block command. Apps can extend the default list. */
export interface SlashCommandItem {
  title: string;
  description: string;
  /**
   * Optional hidden search text. Use this for raw block types and aliases that
   * should match slash queries without making the visible description verbose.
   */
  searchText?: string;
  /** Short text glyph shown in the menu (T, H1, tbl, …). */
  icon: string;
  action: (editor: Editor) => void;
}

/**
 * The default block commands — Plan's current set. Apps pass their own `items`
 * (typically `[...DEFAULT_SLASH_COMMANDS, ...extra]`) to extend it.
 */
export const DEFAULT_SLASH_COMMANDS: SlashCommandItem[] = [
  {
    title: "Text",
    description: "Plain text block",
    icon: "T",
    action: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    title: "Heading 1",
    description: "Large heading",
    icon: "H1",
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Section heading",
    icon: "H2",
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Subheading",
    icon: "H3",
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Bulleted list",
    description: "Unordered list",
    icon: "-",
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    description: "Ordered list",
    icon: "1.",
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: "To-do list",
    description: "Checklist items",
    icon: "[]",
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    title: "Quote",
    description: "Block quote",
    icon: '"',
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    title: "Code block",
    description: "Code snippet",
    icon: "<>",
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    icon: "-",
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    title: "Table",
    description: "Three by three table",
    icon: "tbl",
    action: (editor) =>
      editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
];

/**
 * Build the `/image` slash command for the shared image block. Requires the
 * editor to mount the shared image extension (`features.image`) and an
 * {@link ImageUploadFn}; the command opens a native file picker and uploads +
 * inserts the chosen image(s). Add it to the list an app passes to
 * {@link SlashCommandMenu} (e.g. `[...DEFAULT_SLASH_COMMANDS, createImageSlashCommand(upload)]`).
 */
export function createImageSlashCommand(
  upload: ImageUploadFn,
): SlashCommandItem {
  return {
    title: "Image",
    description: "Upload an image",
    icon: "img",
    action: (editor) => pickAndInsertImage(editor.view, upload),
  };
}

export interface SlashCommandMenuProps {
  editor: Editor;
  /** Block command list. Defaults to {@link DEFAULT_SLASH_COMMANDS}. */
  items?: SlashCommandItem[];
}

/**
 * The shared "/" block-insert menu. Detects a `/query` at the caret, filters the
 * provided command list, and renders a fixed-position picker with keyboard
 * navigation. Extracted from the inline plan menu so apps share one
 * implementation and only swap the command list.
 */
export function SlashCommandMenu({
  editor,
  items = DEFAULT_SLASH_COMMANDS,
}: SlashCommandMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    flipUp: boolean;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement>(null);
  const slashPosRef = useRef<number | null>(null);

  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.toLowerCase();
    return items.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(normalizedQuery) ||
        cmd.description.toLowerCase().includes(normalizedQuery) ||
        cmd.searchText?.toLowerCase().includes(normalizedQuery),
    );
  }, [items, query]);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    slashPosRef.current = null;
  }, []);

  const executeCommand = useCallback(
    (command: SlashCommandItem) => {
      if (slashPosRef.current !== null) {
        const { from } = editor.state.selection;
        editor
          .chain()
          .focus()
          .deleteRange({ from: slashPosRef.current, to: from })
          .run();
      }
      command.action(editor);
      close();
    },
    [close, editor],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isOpen) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (filteredCommands.length === 0) return;
        setSelectedIndex((index) => (index + 1) % filteredCommands.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (filteredCommands.length === 0) return;
        setSelectedIndex(
          (index) =>
            (index - 1 + filteredCommands.length) % filteredCommands.length,
        );
      } else if (event.key === "Enter") {
        event.preventDefault();
        const command = filteredCommands[selectedIndex];
        if (command) executeCommand(command);
      } else if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [close, executeCommand, filteredCommands, isOpen, selectedIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const menu = menuRef.current;
    const item = selectedItemRef.current;
    if (!menu || !item) return;

    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    const visibleTop = menu.scrollTop;
    const visibleBottom = visibleTop + menu.clientHeight;

    if (itemTop < visibleTop) {
      menu.scrollTop = itemTop;
    } else if (itemBottom > visibleBottom) {
      menu.scrollTop = itemBottom - menu.clientHeight;
    }
  }, [filteredCommands.length, isOpen, selectedIndex]);

  useEffect(() => {
    const handleTransaction = () => {
      const { state } = editor;
      const { from } = state.selection;
      const textBefore = state.doc.textBetween(
        Math.max(0, from - 32),
        from,
        "\n",
      );
      const slashMatch = textBefore.match(/\/([a-zA-Z0-9 ]*)$/);
      if (!slashMatch) {
        if (isOpen) close();
        return;
      }

      const slashStart = from - slashMatch[0].length;
      slashPosRef.current = slashStart;
      setQuery(slashMatch[1]);
      setSelectedIndex(0);
      const coords = editor.view.coordsAtPos(from);
      const menuHeight = 320;
      const spaceBelow = window.innerHeight - coords.bottom;
      const flipUp = spaceBelow < menuHeight && coords.top > menuHeight;
      setPosition({
        top: flipUp ? coords.top : coords.bottom + 4,
        left: Math.min(coords.left, window.innerWidth - 250),
        flipUp,
      });
      setIsOpen(true);
    };

    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [close, editor, isOpen]);

  if (!isOpen || !position || filteredCommands.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="an-rich-md-slash-menu"
      style={
        {
          position: "fixed",
          ...(position.flipUp
            ? { bottom: window.innerHeight - position.top + 4 }
            : { top: position.top }),
          left: position.left,
        } as CSSProperties
      }
      data-plan-interactive
    >
      <div className="an-rich-md-slash-heading">Blocks</div>
      {filteredCommands.map((command, index) => (
        <button
          key={command.title}
          ref={index === selectedIndex ? selectedItemRef : undefined}
          type="button"
          className={cn(
            "an-rich-md-slash-item",
            index === selectedIndex && "an-rich-md-slash-item--active",
          )}
          onMouseEnter={() => setSelectedIndex(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => executeCommand(command)}
        >
          <span className="an-rich-md-slash-icon">{command.icon}</span>
          <span className="an-rich-md-slash-copy">
            <span className="an-rich-md-slash-title">{command.title}</span>
            <span className="an-rich-md-slash-description">
              {command.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
