import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Editor } from "@tiptap/react";
import {
  IconTypography,
  IconH1,
  IconH2,
  IconH3,
  IconList,
  IconListNumbers,
  IconSquareCheck,
  IconChevronRight,
  IconCode,
  IconQuote,
  IconMinus,
  IconTable as TableIcon,
  IconWand,
  IconArrowUp,
  IconInfoCircle,
} from "@tabler/icons-react";
import { useSendToAgentChat } from "@agent-native/core/client";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface SlashCommandMenuProps {
  editor: Editor;
  documentId?: string;
}

interface CommandItem {
  title: string;
  description: string;
  icon: React.ElementType;
  action: (editor: Editor) => void;
}

const commands: CommandItem[] = [
  {
    title: "Text",
    description: "Plain text block",
    icon: IconTypography,
    action: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    title: "Heading 1",
    description: "Large heading",
    icon: IconH1,
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium heading",
    icon: IconH2,
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Small heading",
    icon: IconH3,
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Bullet List",
    description: "Unordered list",
    icon: IconList,
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: "Numbered List",
    description: "Ordered list",
    icon: IconListNumbers,
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: "To-do List",
    description: "Checklist items",
    icon: IconSquareCheck,
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    title: "Toggle",
    description: "Notion-style toggle line",
    icon: IconChevronRight,
    action: (editor) =>
      editor
        .chain()
        .focus()
        .insertContent({
          type: "notionToggle",
          attrs: { summary: "Toggle" },
          content: [{ type: "paragraph" }],
        })
        .run(),
  },
  {
    title: "Code Block",
    description: "Code snippet",
    icon: IconCode,
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: "Quote",
    description: "Block quote",
    icon: IconQuote,
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    title: "Callout",
    description: "Highlighted info block",
    icon: IconInfoCircle,
    action: (editor) =>
      editor
        .chain()
        .focus()
        .insertContent({
          type: "notionCallout",
          attrs: { icon: "💡" },
          content: [{ type: "paragraph" }],
        })
        .run(),
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    icon: IconMinus,
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    title: "Table",
    description: "Add a table",
    icon: TableIcon,
    action: (editor) =>
      editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
];

// "Turn into" commands — convert existing block, use set instead of toggle for headings
const turnIntoCommands: CommandItem[] = [
  {
    title: "Text",
    description: "Plain text block",
    icon: IconTypography,
    action: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    title: "Heading 1",
    description: "Large heading",
    icon: IconH1,
    action: (editor) => editor.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium heading",
    icon: IconH2,
    action: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Small heading",
    icon: IconH3,
    action: (editor) => editor.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    title: "Bullet List",
    description: "Unordered list",
    icon: IconList,
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: "Numbered List",
    description: "Ordered list",
    icon: IconListNumbers,
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: "To-do List",
    description: "Checklist items",
    icon: IconSquareCheck,
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    title: "Toggle",
    description: "Collapsible block",
    icon: IconChevronRight,
    action: (editor) => {
      // Grab remaining text (slash already deleted by executeCommand)
      const { state } = editor;
      const { $from } = state.selection;
      const text = $from.parent.textContent;
      // Select the entire current block, then replace with toggle
      const blockStart = $from.start();
      const blockEnd = $from.end();
      editor
        .chain()
        .focus()
        .deleteRange({ from: blockStart, to: blockEnd })
        .insertContent({
          type: "notionToggle",
          attrs: { summary: text },
          content: [{ type: "paragraph" }],
        })
        .run();
    },
  },
  {
    title: "Code Block",
    description: "Code snippet",
    icon: IconCode,
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: "Quote",
    description: "Block quote",
    icon: IconQuote,
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    title: "Callout",
    description: "Highlighted info block",
    icon: IconInfoCircle,
    action: (editor) => {
      const { state } = editor;
      const { $from } = state.selection;
      const text = $from.parent.textContent;
      const blockStart = $from.start();
      const blockEnd = $from.end();
      editor
        .chain()
        .focus()
        .deleteRange({ from: blockStart, to: blockEnd })
        .insertContent({
          type: "notionCallout",
          attrs: { icon: "💡" },
          content: text
            ? [{ type: "paragraph", content: [{ type: "text", text }] }]
            : [{ type: "paragraph" }],
        })
        .run();
    },
  },
];

export function SlashCommandMenu({
  editor,
  documentId,
}: SlashCommandMenuProps) {
  const { send } = useSendToAgentChat();

  const [isOpen, setIsOpen] = useState(false);
  const [isTurnInto, setIsTurnInto] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const slashPosRef = useRef<number | null>(null);

  // Generate prompt popover state
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generatePos, setGeneratePos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const generateTextareaRef = useRef<HTMLTextAreaElement>(null);

  const generateCommand: CommandItem = {
    title: "Generate",
    description: "Generate content with AI",
    icon: IconWand,
    action: () => {
      // Show the prompt popover at current position
      setGeneratePos(position);
      setGeneratePrompt("");
      setGenerateOpen(true);
      setTimeout(() => generateTextareaRef.current?.focus(), 0);
    },
  };

  const allCommands = isTurnInto
    ? turnIntoCommands
    : [generateCommand, ...commands];

  const filteredCommands = allCommands.filter(
    (cmd) =>
      cmd.title.toLowerCase().includes(query.toLowerCase()) ||
      cmd.description.toLowerCase().includes(query.toLowerCase()),
  );

  function handleGenerateSubmit() {
    if (!generatePrompt.trim()) return;
    if (!documentId) {
      toast.error("No document selected");
      return;
    }
    setGenerateOpen(false);
    const content = (editor.storage as any).markdown.getMarkdown();
    send({
      message: generatePrompt.trim(),
      context: `The user is asking you to generate content for their document (id: ${documentId}). Use the update-document action to write the generated markdown content. Do NOT use db-exec or raw SQL — use \`update-document --id ${documentId} --content "..."\` (and \`--title\` if appropriate).${content ? `\n\nCurrent document content:\n${content}` : "\n\nThe document is currently empty."}`,
    });
  }

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
      setIsTurnInto(false);
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
        setIsTurnInto(false);
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

        // Detect "turn into" mode: "/" is at start of a non-empty block
        const resolved = state.doc.resolve(slashStart);
        const parentNode = resolved.parent;
        const offsetInParent = resolved.parentOffset;
        const blockHasOtherContent =
          parentNode.textContent.length > slashMatch[0].length;
        const slashAtBlockStart = offsetInParent === 0;
        setIsTurnInto(slashAtBlockStart && blockHasOtherContent);

        const coords = editor.view.coordsAtPos(from);
        const editorRect = editor.view.dom
          .closest(".visual-editor-wrapper")
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
          setIsTurnInto(false);
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

  return (
    <>
      {/* Slash command menu */}
      {isOpen && position && filteredCommands.length > 0 && (
        <div
          ref={menuRef}
          className="slash-command-menu"
          style={{
            position: "absolute",
            top: position.top,
            left: 0,
            right: 0,
            maxWidth: "min(300px, calc(100vw - 2rem))",
            marginLeft: Math.min(position.left, 16),
            zIndex: 50,
          }}
        >
          <div className="py-1.5">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {isTurnInto ? "Turn into" : "Blocks"}
            </div>
            {filteredCommands.map((cmd) => {
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
          </div>
        </div>
      )}

      {/* Generate prompt popover */}
      {generatePos && (
        <Popover open={generateOpen} onOpenChange={setGenerateOpen}>
          <PopoverTrigger asChild>
            <span
              className="absolute h-0 w-0 pointer-events-none"
              style={{
                top: generatePos.top,
                left: Math.min(generatePos.left, 16),
              }}
            />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="bottom"
            className="w-[calc(100vw-2rem)] max-w-80 rounded-xl p-0"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              generateTextareaRef.current?.focus();
            }}
          >
            <div className="p-4 pb-3">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <IconWand size={14} className="text-muted-foreground" />
                Generate with AI
              </p>
              <textarea
                ref={generateTextareaRef}
                value={generatePrompt}
                onChange={(e) => setGeneratePrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerateSubmit();
                  }
                  if (e.key === "Escape") {
                    setGenerateOpen(false);
                  }
                }}
                placeholder="Describe what to generate..."
                className="mt-2 w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground/50 focus:outline-none"
                rows={3}
              />
            </div>
            <div className="flex items-center justify-end border-t border-border px-4 py-2.5">
              <button
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted hover:bg-accent disabled:opacity-30"
                onClick={handleGenerateSubmit}
                disabled={!generatePrompt.trim()}
              >
                <IconArrowUp size={14} />
              </button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </>
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
      <div className="flex items-center justify-center w-9 h-9 rounded-md border border-border bg-background text-muted-foreground">
        <cmd.icon size={18} />
      </div>
      <div>
        <div className="text-sm font-medium text-foreground">{cmd.title}</div>
        <div className="text-xs text-muted-foreground">{cmd.description}</div>
      </div>
    </button>
  );
}
