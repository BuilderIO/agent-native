import { useState, useEffect, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Code2,
  Quote,
  Minus,
  Sparkles,
  ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ComposeSlashMenuProps {
  editor: Editor;
  onGenerate: () => void;
}

interface CommandItem {
  title: string;
  description: string;
  icon: React.ElementType;
  action: (editor: Editor) => void;
  category?: string;
}

function createCommands(onGenerate: () => void): CommandItem[] {
  return [
    {
      title: "Text",
      description: "Plain text block",
      icon: Type,
      category: "basic",
      action: (editor) => editor.chain().focus().setParagraph().run(),
    },
    {
      title: "Heading 1",
      description: "Large heading",
      icon: Heading1,
      category: "basic",
      action: (editor) =>
        editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      title: "Heading 2",
      description: "Medium heading",
      icon: Heading2,
      category: "basic",
      action: (editor) =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      title: "Heading 3",
      description: "Small heading",
      icon: Heading3,
      category: "basic",
      action: (editor) =>
        editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      title: "Bullet List",
      description: "Unordered list",
      icon: List,
      category: "basic",
      action: (editor) => editor.chain().focus().toggleBulletList().run(),
    },
    {
      title: "Numbered List",
      description: "Ordered list",
      icon: ListOrdered,
      category: "basic",
      action: (editor) => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      title: "Quote",
      description: "Block quote",
      icon: Quote,
      category: "basic",
      action: (editor) => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      title: "Code Block",
      description: "Code snippet",
      icon: Code2,
      category: "basic",
      action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      title: "Divider",
      description: "Horizontal rule",
      icon: Minus,
      category: "basic",
      action: (editor) => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      title: "Image",
      description: "Insert image by URL",
      icon: ImageIcon,
      category: "media",
      action: (editor) => {
        const url = window.prompt("Image URL:");
        if (url?.trim()) {
          editor.chain().focus().setImage({ src: url.trim() }).run();
        }
      },
    },
    {
      title: "Generate",
      description: "AI-assisted writing",
      icon: Sparkles,
      category: "ai",
      action: (_editor) => {
        onGenerate();
      },
    },
  ];
}

export function ComposeSlashMenu({
  editor,
  onGenerate,
}: ComposeSlashMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const slashPosRef = useRef<number | null>(null);

  const commands = createCommands(onGenerate);

  const filteredCommands = commands.filter(
    (cmd) =>
      cmd.title.toLowerCase().includes(query.toLowerCase()) ||
      cmd.description.toLowerCase().includes(query.toLowerCase()),
  );

  const executeCommand = useCallback(
    (cmd: CommandItem) => {
      if (slashPosRef.current !== null) {
        const { from } = editor.state.selection;
        editor
          .chain()
          .focus()
          .deleteRange({ from: slashPosRef.current, to: from })
          .run();
      }
      cmd.action(editor);
      setIsOpen(false);
      setQuery("");
      slashPosRef.current = null;
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filteredCommands.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (i) => (i - 1 + filteredCommands.length) % filteredCommands.length,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          executeCommand(filteredCommands[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        setIsOpen(false);
        setQuery("");
        slashPosRef.current = null;
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, selectedIndex, filteredCommands, executeCommand, editor]);

  useEffect(() => {
    if (!editor) return;

    const handleTransaction = () => {
      const { state } = editor;
      const { from } = state.selection;
      const textBefore = state.doc.textBetween(
        Math.max(0, from - 20),
        from,
        "\n",
      );

      const slashMatch = textBefore.match(/\/([a-zA-Z0-9]*)$/);

      if (slashMatch) {
        const slashStart = from - slashMatch[0].length;
        slashPosRef.current = slashStart;
        setQuery(slashMatch[1]);
        setSelectedIndex(0);

        const coords = editor.view.coordsAtPos(from);
        const editorRect = editor.view.dom
          .closest(".compose-editor-wrapper")
          ?.getBoundingClientRect();
        if (editorRect) {
          setPosition({
            top: coords.bottom - editorRect.top + 4,
            left: coords.left - editorRect.left,
          });
        }
        setIsOpen(true);
      } else {
        if (isOpen) {
          setIsOpen(false);
          setQuery("");
          slashPosRef.current = null;
        }
      }
    };

    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor, isOpen]);

  if (!isOpen || !position || filteredCommands.length === 0) return null;

  const basicCommands = filteredCommands.filter((c) => c.category === "basic");
  const mediaCommands = filteredCommands.filter((c) => c.category === "media");
  const aiCommands = filteredCommands.filter((c) => c.category === "ai");

  return (
    <div
      ref={menuRef}
      className="slash-command-menu"
      style={{
        position: "absolute",
        top: position.top,
        left: Math.min(position.left, 300),
        zIndex: 50,
      }}
    >
      <div className="py-1.5">
        {basicCommands.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Blocks
            </div>
            {basicCommands.map((cmd) => {
              const globalIndex = filteredCommands.indexOf(cmd);
              return (
                <CommandButton
                  key={cmd.title}
                  cmd={cmd}
                  isSelected={globalIndex === selectedIndex}
                  onExecute={() => executeCommand(cmd)}
                  onHover={() => setSelectedIndex(globalIndex)}
                />
              );
            })}
          </>
        )}
        {mediaCommands.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Media
            </div>
            {mediaCommands.map((cmd) => {
              const globalIndex = filteredCommands.indexOf(cmd);
              return (
                <CommandButton
                  key={cmd.title}
                  cmd={cmd}
                  isSelected={globalIndex === selectedIndex}
                  onExecute={() => executeCommand(cmd)}
                  onHover={() => setSelectedIndex(globalIndex)}
                />
              );
            })}
          </>
        )}
        {aiCommands.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              AI
            </div>
            {aiCommands.map((cmd) => {
              const globalIndex = filteredCommands.indexOf(cmd);
              return (
                <CommandButton
                  key={cmd.title}
                  cmd={cmd}
                  isSelected={globalIndex === selectedIndex}
                  onExecute={() => executeCommand(cmd)}
                  onHover={() => setSelectedIndex(globalIndex)}
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function CommandButton({
  cmd,
  isSelected,
  onExecute,
  onHover,
}: {
  cmd: CommandItem;
  isSelected: boolean;
  onExecute: () => void;
  onHover: () => void;
}) {
  return (
    <button
      onClick={onExecute}
      onMouseEnter={onHover}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
        isSelected ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <div className="flex items-center justify-center w-8 h-8 rounded-md border border-border bg-background text-muted-foreground">
        <cmd.icon size={16} />
      </div>
      <div>
        <div className="text-sm font-medium text-foreground">{cmd.title}</div>
        <div className="text-xs text-muted-foreground">{cmd.description}</div>
      </div>
    </button>
  );
}
