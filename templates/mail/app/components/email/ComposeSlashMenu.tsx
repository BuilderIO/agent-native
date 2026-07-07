import { useT } from "@agent-native/core/client";
import {
  IconTypography,
  IconH1,
  IconH2,
  IconH3,
  IconList,
  IconListNumbers,
  IconCode,
  IconQuote,
  IconMinus,
  IconPencil,
  IconPhoto,
  IconMessage2,
} from "@tabler/icons-react";
import type { Editor } from "@tiptap/react";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
} from "react";

import { useSnippets, type Snippet } from "@/hooks/use-snippets";
import { openFilePicker } from "@/lib/upload";
import { cn } from "@/lib/utils";
interface ComposeSlashMenuProps {
  editor: Editor;
  onGenerate: () => void;
  onUploadImage: (file: File) => Promise<string>;
}

interface CommandItem {
  // Either a translation key or a literal string may be supplied — literal
  // strings win, so dynamic (non-translatable) content like a saved snippet's
  // name can share the same command shape as the built-in i18n-keyed items.
  titleKey?: string;
  title?: string;
  descriptionKey?: string;
  description?: string;
  icon: React.ElementType;
  action: (editor: Editor) => void;
  category?: string;
}

/**
 * Case-insensitive subsequence match: every character of `query` must appear
 * in `text` in order, not necessarily contiguously (e.g. "mtg" matches
 * "meeting"). Empty query matches everything.
 */
function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true;
  const haystack = text.toLowerCase();
  let position = 0;
  for (const char of query.toLowerCase()) {
    position = haystack.indexOf(char, position);
    if (position === -1) return false;
    position += 1;
  }
  return true;
}

function createSnippetCommands(snippets: Snippet[]): CommandItem[] {
  return snippets.map((snippet) => ({
    title: snippet.name,
    description: snippet.body,
    icon: IconMessage2,
    category: "snippets",
    action: (editor) => {
      editor.chain().focus().insertContent(snippet.body).run();
    },
  }));
}

function createCommands(
  onGenerate: () => void,
  onInsertImage: (editor: Editor) => void,
): CommandItem[] {
  return [
    {
      titleKey: "mail.composeSlash.text",
      descriptionKey: "mail.composeSlash.plainTextBlock",
      icon: IconTypography,
      category: "basic",
      action: (editor) => (editor.chain().focus() as any).setParagraph().run(),
    },
    {
      titleKey: "mail.composeSlash.heading1",
      descriptionKey: "mail.composeSlash.largeHeading",
      icon: IconH1,
      category: "basic",
      action: (editor) =>
        (editor.chain().focus() as any).toggleHeading({ level: 1 }).run(),
    },
    {
      titleKey: "mail.composeSlash.heading2",
      descriptionKey: "mail.composeSlash.mediumHeading",
      icon: IconH2,
      category: "basic",
      action: (editor) =>
        (editor.chain().focus() as any).toggleHeading({ level: 2 }).run(),
    },
    {
      titleKey: "mail.composeSlash.heading3",
      descriptionKey: "mail.composeSlash.smallHeading",
      icon: IconH3,
      category: "basic",
      action: (editor) =>
        (editor.chain().focus() as any).toggleHeading({ level: 3 }).run(),
    },
    {
      titleKey: "mail.composeSlash.bulletList",
      descriptionKey: "mail.composeSlash.unorderedList",
      icon: IconList,
      category: "basic",
      action: (editor) =>
        (editor.chain().focus() as any).toggleBulletList().run(),
    },
    {
      titleKey: "mail.composeSlash.numberedList",
      descriptionKey: "mail.composeSlash.orderedList",
      icon: IconListNumbers,
      category: "basic",
      action: (editor) =>
        (editor.chain().focus() as any).toggleOrderedList().run(),
    },
    {
      titleKey: "mail.composeSlash.quote",
      descriptionKey: "mail.composeSlash.blockQuote",
      icon: IconQuote,
      category: "basic",
      action: (editor) =>
        (editor.chain().focus() as any).toggleBlockquote().run(),
    },
    {
      titleKey: "mail.composeSlash.codeBlock",
      descriptionKey: "mail.composeSlash.codeSnippet",
      icon: IconCode,
      category: "basic",
      action: (editor) =>
        (editor.chain().focus() as any).toggleCodeBlock().run(),
    },
    {
      titleKey: "mail.composeSlash.divider",
      descriptionKey: "mail.composeSlash.horizontalRule",
      icon: IconMinus,
      category: "basic",
      action: (editor) =>
        (editor.chain().focus() as any).setHorizontalRule().run(),
    },
    {
      titleKey: "mail.composeSlash.image",
      descriptionKey: "mail.composeSlash.uploadImage",
      icon: IconPhoto,
      category: "media",
      action: onInsertImage,
    },
    {
      titleKey: "mail.composeSlash.generate",
      descriptionKey: "mail.composeSlash.aiAssistedWriting",
      icon: IconPencil,
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
  onUploadImage,
}: ComposeSlashMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [cursorCoords, setCursorCoords] = useState<{
    cursorTop: number;
    cursorBottom: number;
    cursorLeft: number;
    editorTop: number;
    editorLeft: number;
  } | null>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const slashPosRef = useRef<number | null>(null);
  const t = useT();
  const { data: snippetsData } = useSnippets();
  const snippets = snippetsData?.snippets ?? [];

  const handleInsertImage = useCallback(
    (targetEditor: Editor) => {
      void (async () => {
        const file = await openFilePicker("image/*");
        if (!file) return;
        const objectUrl = URL.createObjectURL(file);
        targetEditor
          .chain()
          .focus()
          .setImage({ src: objectUrl, alt: "" })
          .run();
        try {
          const url = await onUploadImage(file);
          targetEditor.state.doc.descendants((node, pos) => {
            if (node.type.name === "image" && node.attrs.src === objectUrl) {
              targetEditor
                .chain()
                .command(({ tr }) => {
                  tr.setNodeAttribute(pos, "src", url);
                  return true;
                })
                .run();
              return false;
            }
            return true;
          });
        } catch {
          targetEditor.state.doc.descendants((node, pos) => {
            if (node.type.name === "image" && node.attrs.src === objectUrl) {
              targetEditor
                .chain()
                .deleteRange({ from: pos, to: pos + node.nodeSize })
                .run();
              return false;
            }
            return true;
          });
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      })();
    },
    [onUploadImage],
  );

  const commands = createCommands(onGenerate, handleInsertImage);
  const snippetCommands = createSnippetCommands(snippets);

  const filteredCommands = [
    ...commands.filter(
      (cmd) =>
        t(cmd.titleKey ?? "")
          .toLowerCase()
          .includes(query.toLowerCase()) ||
        t(cmd.descriptionKey ?? "")
          .toLowerCase()
          .includes(query.toLowerCase()),
    ),
    ...snippetCommands.filter(
      (cmd) =>
        fuzzyMatch(cmd.title ?? "", query) ||
        fuzzyMatch(cmd.description ?? "", query),
    ),
  ];

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
          setCursorCoords({
            cursorTop: coords.top,
            cursorBottom: coords.bottom,
            cursorLeft: coords.left,
            editorTop: editorRect.top,
            editorLeft: editorRect.left,
          });
        }
        setIsOpen(true);
      } else {
        if (isOpen) {
          setIsOpen(false);
          setQuery("");
          setPosition(null);
          setCursorCoords(null);
          slashPosRef.current = null;
        }
      }
    };

    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor, isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !cursorCoords || !menuRef.current) return;
    const menuHeight = menuRef.current.offsetHeight;
    const gap = 4;
    const margin = 8;
    const spaceBelow = window.innerHeight - cursorCoords.cursorBottom - margin;
    const spaceAbove = cursorCoords.cursorTop - margin;
    const placeAbove = spaceBelow < menuHeight + gap && spaceAbove > spaceBelow;
    setPosition({
      top: placeAbove
        ? cursorCoords.cursorTop - cursorCoords.editorTop - menuHeight - gap
        : cursorCoords.cursorBottom - cursorCoords.editorTop + gap,
      left: cursorCoords.cursorLeft - cursorCoords.editorLeft,
    });
  }, [isOpen, cursorCoords, filteredCommands.length]);

  if (!isOpen || !cursorCoords || filteredCommands.length === 0) return null;

  const basicCommands = filteredCommands.filter((c) => c.category === "basic");
  const mediaCommands = filteredCommands.filter((c) => c.category === "media");
  const snippetGroup = filteredCommands.filter(
    (c) => c.category === "snippets",
  );
  const aiCommands = filteredCommands.filter((c) => c.category === "ai");

  return (
    <div
      ref={menuRef}
      className="slash-command-menu"
      style={{
        position: "absolute",
        top: position?.top ?? 0,
        left: position ? Math.min(position.left, 300) : 0,
        visibility: position ? "visible" : "hidden",
        zIndex: 50,
      }}
    >
      <div className="py-1.5">
        {basicCommands.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("mail.composeSlash.blocks")}
            </div>
            {basicCommands.map((cmd) => {
              const globalIndex = filteredCommands.indexOf(cmd);
              return (
                <CommandButton
                  key={cmd.titleKey}
                  cmd={cmd}
                  t={t}
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
              {t("mail.composeSlash.media")}
            </div>
            {mediaCommands.map((cmd) => {
              const globalIndex = filteredCommands.indexOf(cmd);
              return (
                <CommandButton
                  key={cmd.titleKey}
                  cmd={cmd}
                  t={t}
                  isSelected={globalIndex === selectedIndex}
                  onExecute={() => executeCommand(cmd)}
                  onHover={() => setSelectedIndex(globalIndex)}
                />
              );
            })}
          </>
        )}
        {snippetGroup.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("mail.composeSlash.snippets")}
            </div>
            {snippetGroup.map((cmd) => {
              const globalIndex = filteredCommands.indexOf(cmd);
              return (
                <CommandButton
                  key={cmd.title}
                  cmd={cmd}
                  t={t}
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
              {t("mail.composeSlash.ai")}
            </div>
            {aiCommands.map((cmd) => {
              const globalIndex = filteredCommands.indexOf(cmd);
              return (
                <CommandButton
                  key={cmd.titleKey}
                  cmd={cmd}
                  t={t}
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
  t,
  isSelected,
  onExecute,
  onHover,
}: {
  cmd: CommandItem;
  t: ReturnType<typeof useT>;
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
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground truncate">
          {cmd.title ?? t(cmd.titleKey ?? "")}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {cmd.description ?? t(cmd.descriptionKey ?? "")}
        </div>
      </div>
    </button>
  );
}
