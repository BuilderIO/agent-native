import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Editor } from "@tiptap/react";
import {
  IconTypography,
  IconH1,
  IconH2,
  IconH3,
  IconH4,
  IconList,
  IconListNumbers,
  IconSquareCheck,
  IconChevronRight,
  IconCode,
  IconMinus,
  IconTable as TableIcon,
  IconWand,
  IconArrowUp,
  IconInfoCircle,
  IconMusic,
  IconPhoto,
  IconFileText,
  IconDatabase,
  IconVideo,
} from "@tabler/icons-react";
import { useSendToAgentChat } from "@agent-native/core/client";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCreateContentDatabase } from "@/hooks/use-content-database";
import { useCreatePage } from "@/hooks/use-create-page";
import { focusMostRecentEmptyToggleSummary } from "./extensions/NotionExtensions";
import { contentBlockRegistry } from "@/blocks/contentBlockRegistry";
import { buildRegistrySlashItems } from "./registrySlashItems";
import { localContentComponents } from "@/local-components";
import { buildLocalComponentSlashItems } from "./localComponentSlashItems";

interface SlashCommandMenuProps {
  editor: Editor;
  documentId?: string;
  /**
   * The open document's linked Notion page id, when it has one. When set, the
   * registry-derived block slash items are filtered to specs that round-trip to
   * Notion-Flavored Markdown (`spec.notionCompatible`), so authors can't add a
   * structured block that would silently drop on the next Notion push. When
   * unset (the common case), all registry blocks are offered.
   */
  notionPageId?: string | null;
}

interface EditorMenuPosition {
  top: number;
  left: number;
}

interface CommandItem {
  title: string;
  description: string;
  searchText?: string;
  shortcut?: string;
  icon: React.ElementType;
  action: (editor: Editor) => void | boolean | Promise<void>;
}

export function setPlainTextBlock(editor: Editor) {
  const chain = editor.chain().focus();
  if (typeof (chain as any).setParagraph === "function") {
    return (chain as any).setParagraph().run();
  }
  return chain.setNode("paragraph").run();
}

function QuoteCommandIcon({ size = 22 }: { size?: number; stroke?: number }) {
  return (
    <span
      aria-hidden="true"
      className="font-serif font-semibold leading-none"
      style={{ fontSize: Math.round(size * 1.15) }}
    >
      &quot;
    </span>
  );
}

export function parseInlineGeneratePrompt(textBeforeCursor: string) {
  const match = textBeforeCursor.match(/^\/generate\s+([\s\S]+)$/i);
  const prompt = match?.[1]?.trim();
  return prompt || null;
}

export function shouldOpenGenerateOnSpace(editor: Editor) {
  const { selection } = editor.state;
  if (!selection.empty) return false;

  const { $from } = selection;
  if (!$from.parent.isTextblock) return false;
  if ($from.parent.type.name !== "paragraph") return false;
  if ($from.parentOffset !== 0) return false;

  return $from.parent.textContent.trim().length === 0;
}

export function parseSlashCommandQuery(textBeforeCursor: string) {
  return textBeforeCursor.match(/^\s*\/([a-zA-Z0-9]*)$/)?.[1] ?? null;
}

const commands: CommandItem[] = [
  {
    title: "Text",
    description: "Plain text block",
    icon: IconTypography,
    action: setPlainTextBlock,
  },
  {
    title: "Heading 1",
    description: "Large heading",
    shortcut: "#",
    icon: IconH1,
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium heading",
    shortcut: "##",
    icon: IconH2,
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Small heading",
    shortcut: "###",
    icon: IconH3,
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Heading 4",
    description: "Subheading",
    shortcut: "####",
    icon: IconH4,
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 4 }).run(),
  },
  {
    title: "Bulleted list",
    description: "Unordered list",
    shortcut: "-",
    icon: IconList,
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    description: "Ordered list",
    shortcut: "1.",
    icon: IconListNumbers,
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: "To-do list",
    description: "Checklist items",
    shortcut: "[]",
    icon: IconSquareCheck,
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    title: "Toggle",
    description: "Notion-style toggle line",
    shortcut: ">",
    icon: IconChevronRight,
    action: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "notionToggle",
          attrs: { summary: "", open: true },
          content: [{ type: "paragraph" }],
        })
        .run();
      focusMostRecentEmptyToggleSummary(editor);
    },
  },
  {
    title: "Code Block",
    description: "Code snippet",
    shortcut: "```",
    icon: IconCode,
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: "Quote",
    description: "Block quote",
    shortcut: '"',
    icon: QuoteCommandIcon,
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
    shortcut: "---",
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
        .insertTable({ rows: 3, cols: 3, withHeaderRow: false })
        .run(),
  },
];

// "Turn into" commands — convert existing block, use set instead of toggle for headings
const turnIntoCommands: CommandItem[] = [
  {
    title: "Text",
    description: "Plain text block",
    icon: IconTypography,
    action: setPlainTextBlock,
  },
  {
    title: "Heading 1",
    description: "Large heading",
    shortcut: "#",
    icon: IconH1,
    action: (editor) => editor.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium heading",
    shortcut: "##",
    icon: IconH2,
    action: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Small heading",
    shortcut: "###",
    icon: IconH3,
    action: (editor) => editor.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    title: "Heading 4",
    description: "Subheading",
    shortcut: "####",
    icon: IconH4,
    action: (editor) => editor.chain().focus().setHeading({ level: 4 }).run(),
  },
  {
    title: "Bulleted list",
    description: "Unordered list",
    shortcut: "-",
    icon: IconList,
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    description: "Ordered list",
    shortcut: "1.",
    icon: IconListNumbers,
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: "To-do list",
    description: "Checklist items",
    shortcut: "[]",
    icon: IconSquareCheck,
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    title: "Toggle",
    description: "Collapsible block",
    shortcut: ">",
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
          attrs: { summary: text, open: true },
          content: [{ type: "paragraph" }],
        })
        .run();
      if (!text) focusMostRecentEmptyToggleSummary(editor);
    },
  },
  {
    title: "Code Block",
    description: "Code snippet",
    shortcut: "```",
    icon: IconCode,
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: "Quote",
    description: "Block quote",
    shortcut: '"',
    icon: QuoteCommandIcon,
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
  notionPageId,
}: SlashCommandMenuProps) {
  const { send } = useSendToAgentChat();
  const navigate = useNavigate();
  const createPage = useCreatePage();
  const createDatabase = useCreateContentDatabase(documentId ?? null);

  const [isOpen, setIsOpen] = useState(false);
  const [isTurnInto, setIsTurnInto] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState<EditorMenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement>(null);
  const slashPosRef = useRef<number | null>(null);

  // Generate prompt popover state
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generatePos, setGeneratePos] = useState<EditorMenuPosition | null>(
    null,
  );
  const generateTextareaRef = useRef<HTMLTextAreaElement>(null);

  const submitGeneratePrompt = useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      if (!documentId) {
        toast.error("No document selected");
        return;
      }
      setGenerateOpen(false);
      const content = (editor.storage as any).markdown.getMarkdown();
      send({
        message: trimmed,
        context: `The user is asking you to generate content for their document (id: ${documentId}). Use the update-document action to write the generated markdown content. Do NOT use db-exec or raw SQL - use \`update-document --id ${documentId} --content "..."\` (and \`--title\` if appropriate).${content ? `\n\nCurrent document content:\n${content}` : "\n\nThe document is currently empty."}`,
      });
    },
    [documentId, editor, send],
  );

  const getSelectionMenuPosition = useCallback(() => {
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    const editorRect = editor.view.dom
      .closest(".visual-editor-wrapper")
      ?.getBoundingClientRect();
    if (!editorRect) return null;

    return {
      top: coords.bottom - editorRect.top + 4,
      left: coords.left - editorRect.left,
    };
  }, [editor]);

  const openGeneratePopover = useCallback(
    (menuPosition: EditorMenuPosition | null = null) => {
      const nextPosition = menuPosition ?? getSelectionMenuPosition();
      if (!nextPosition) return false;

      setGeneratePos(nextPosition);
      setGeneratePrompt("");
      setGenerateOpen(true);
      setTimeout(() => generateTextareaRef.current?.focus(), 0);
      return true;
    },
    [getSelectionMenuPosition],
  );

  const readInlineGenerateCommand = useCallback(() => {
    const { state } = editor;
    if (!state.selection.empty) return null;
    const from = state.selection.from;
    const $from = state.doc.resolve(from);
    if (!$from.parent.isTextblock) return null;

    const blockStart = $from.start();
    const textBeforeCursor = state.doc.textBetween(blockStart, from, "\n");
    const prompt = parseInlineGeneratePrompt(textBeforeCursor);
    if (!prompt) return null;

    return { from: blockStart, to: from, prompt };
  }, [editor]);

  const generateCommand: CommandItem = {
    title: "Generate",
    description: "Generate content with AI",
    icon: IconWand,
    action: () => {
      openGeneratePopover(position);
    },
  };

  const imageCommand: CommandItem = {
    title: "Image",
    description: "Upload or embed image",
    icon: IconPhoto,
    action: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({ type: "image", attrs: { src: null, alt: "" } })
        .run();
    },
  };

  const videoCommand: CommandItem = {
    title: "Video",
    description: "Upload or embed video",
    icon: IconVideo,
    action: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({ type: "video", attrs: { src: null } })
        .run();
    },
  };

  const audioCommand: CommandItem = {
    title: "Audio",
    description: "Upload or embed audio",
    icon: IconMusic,
    action: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({ type: "audio", attrs: { src: null } })
        .run();
    },
  };

  const pageCommand: CommandItem = {
    title: "Page",
    description: "Create a child page",
    icon: IconFileText,
    action: async () => {
      if (!documentId) {
        toast.error("No document selected");
        return;
      }
      await createPage(documentId);
    },
  };

  const databaseCommand: CommandItem = {
    title: "Database",
    description: "Create a child database page",
    icon: IconDatabase,
    action: async () => {
      if (!documentId) {
        toast.error("No document selected");
        return;
      }
      const toastId = toast.loading("Creating database...");
      try {
        const result = await createDatabase.mutateAsync({
          parentId: documentId,
          title: "Untitled database",
        });
        navigate(`/page/${result.database.documentId}`, { flushSync: true });
        toast.success("Database created", { id: toastId });
      } catch (error) {
        toast.error("Failed to create database", {
          id: toastId,
          description:
            error instanceof Error ? error.message : "Something went wrong",
        });
      }
    },
  };

  // Registry-derived block items (the shared dev-doc / OpenAPI / structured
  // library). Filtered to Notion-compatible specs when the document is linked to
  // a Notion page. "Turn into" only converts the current text block, so these
  // insert-only blocks are omitted there.
  const registryCommands = useMemo<CommandItem[]>(
    () =>
      isTurnInto
        ? []
        : (buildRegistrySlashItems(contentBlockRegistry, {
            notionCompatibleOnly: !!notionPageId,
          }) as unknown as CommandItem[]),
    [isTurnInto, notionPageId],
  );
  const localComponentCommands = useMemo<CommandItem[]>(
    () =>
      isTurnInto
        ? []
        : (buildLocalComponentSlashItems(
            localContentComponents,
          ) as unknown as CommandItem[]),
    [isTurnInto],
  );

  const aiCommands = isTurnInto ? [] : [generateCommand];
  const blockCommands = isTurnInto ? turnIntoCommands : commands;
  const pageCommands = isTurnInto ? [] : [pageCommand, databaseCommand];
  const mediaCommands = isTurnInto
    ? []
    : [imageCommand, videoCommand, audioCommand];
  const normalizedQuery = query.toLowerCase();
  const commandMatchesQuery = (cmd: CommandItem) =>
    cmd.title.toLowerCase().includes(normalizedQuery) ||
    cmd.description.toLowerCase().includes(normalizedQuery) ||
    cmd.searchText?.toLowerCase().includes(normalizedQuery);
  const filteredAiCommands = aiCommands.filter(commandMatchesQuery);
  const filteredBlockCommands = blockCommands.filter(commandMatchesQuery);
  const filteredRegistryCommands = registryCommands.filter(commandMatchesQuery);
  const filteredLocalComponentCommands =
    localComponentCommands.filter(commandMatchesQuery);
  const filteredPageCommands = pageCommands.filter(commandMatchesQuery);
  const filteredMediaCommands = mediaCommands.filter(commandMatchesQuery);
  const filteredCommands = [
    ...filteredAiCommands,
    ...filteredBlockCommands,
    ...filteredRegistryCommands,
    ...filteredLocalComponentCommands,
    ...filteredMediaCommands,
    ...filteredPageCommands,
  ];

  const renderCommand = (cmd: CommandItem) => {
    const globalIndex = filteredCommands.indexOf(cmd);
    return (
      <CommandButton
        // Title can collide across groups (e.g. the basic "Table" block and the
        // registry "Table" block), so key by the stable position in the combined
        // list to keep React keys unique.
        key={globalIndex}
        cmd={cmd}
        isSelected={globalIndex === selectedIndex}
        buttonRef={globalIndex === selectedIndex ? selectedItemRef : undefined}
        onExecute={() => executeCommand(cmd)}
        onHover={() => setSelectedIndex(globalIndex)}
      />
    );
  };

  function handleGenerateSubmit() {
    submitGeneratePrompt(generatePrompt);
  }

  const executeCommand = useCallback(
    async (cmd: CommandItem) => {
      if (slashPosRef.current !== null) {
        const { from } = editor.state.selection;
        editor
          .chain()
          .focus()
          .deleteRange({ from: slashPosRef.current, to: from })
          .run();
      }
      setIsOpen(false);
      setIsTurnInto(false);
      setQuery("");
      slashPosRef.current = null;
      await cmd.action(editor);
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) {
        if (
          (e.key === " " || e.code === "Space") &&
          !e.shiftKey &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          editor.isFocused &&
          shouldOpenGenerateOnSpace(editor)
        ) {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(false);
          setIsTurnInto(false);
          setQuery("");
          slashPosRef.current = null;
          openGeneratePopover();
          return;
        }

        if (
          e.key === "Enter" &&
          !e.shiftKey &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey
        ) {
          const inlineGenerate = readInlineGenerateCommand();
          if (inlineGenerate) {
            e.preventDefault();
            editor
              .chain()
              .focus()
              .deleteRange({
                from: inlineGenerate.from,
                to: inlineGenerate.to,
              })
              .run();
            submitGeneratePrompt(inlineGenerate.prompt);
          }
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filteredCommands.length === 0) return;
        setSelectedIndex((i) => (i + 1) % filteredCommands.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filteredCommands.length === 0) return;
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
  }, [
    isOpen,
    selectedIndex,
    filteredCommands,
    executeCommand,
    editor,
    openGeneratePopover,
    readInlineGenerateCommand,
    submitGeneratePrompt,
  ]);

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
    if (!editor) return;

    const handleTransaction = () => {
      const { state } = editor;
      const { from } = state.selection;
      const { $from } = state.selection;
      if (!$from.parent.isTextblock) {
        if (isOpen) {
          setIsOpen(false);
          setIsTurnInto(false);
          setQuery("");
          slashPosRef.current = null;
        }
        return;
      }

      const blockStart = $from.start();
      const textBefore = state.doc.textBetween(blockStart, from, "\n");
      const slashQuery = parseSlashCommandQuery(textBefore);

      if (slashQuery !== null) {
        const slashIndex = textBefore.lastIndexOf("/");
        const slashStart = blockStart + slashIndex;
        slashPosRef.current = slashStart;
        setQuery(slashQuery);
        setSelectedIndex(0);

        // Detect "turn into" mode: "/" is at start of a non-empty block
        const resolved = state.doc.resolve(slashStart);
        const parentNode = resolved.parent;
        const offsetInParent = resolved.parentOffset;
        const blockHasOtherContent =
          parentNode.textContent.length > textBefore.length - slashIndex;
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
            maxWidth: "min(330px, calc(100vw - 2rem))",
            marginLeft: Math.min(position.left, 16),
            zIndex: 50,
          }}
        >
          <div className="py-1.5">
            {filteredAiCommands.length > 0 ? (
              <div className="pb-1">
                <div className="px-3 pt-1 pb-1 text-xs font-semibold text-muted-foreground">
                  AI
                </div>
                {filteredAiCommands.map(renderCommand)}
              </div>
            ) : null}
            {filteredBlockCommands.length > 0 ? (
              <>
                <div className="px-3 pt-1 pb-1 text-xs font-semibold text-muted-foreground">
                  {isTurnInto ? "Turn into" : "Basic blocks"}
                </div>
                {filteredBlockCommands.map(renderCommand)}
              </>
            ) : null}
            {filteredRegistryCommands.length > 0 ? (
              <>
                <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
                  Blocks
                </div>
                {filteredRegistryCommands.map(renderCommand)}
              </>
            ) : null}
            {filteredLocalComponentCommands.length > 0 ? (
              <>
                <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
                  Local components
                </div>
                {filteredLocalComponentCommands.map(renderCommand)}
              </>
            ) : null}
            {filteredMediaCommands.length > 0 ? (
              <>
                <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
                  Media
                </div>
                {filteredMediaCommands.map(renderCommand)}
              </>
            ) : null}
            {filteredPageCommands.length > 0 ? (
              <>
                <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
                  Pages
                </div>
                {filteredPageCommands.map(renderCommand)}
              </>
            ) : null}
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
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
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
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
              <span className="text-[11px] text-muted-foreground/70">
                {/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"}
                +Enter to submit
              </span>
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
  buttonRef,
  onExecute,
  onHover,
}: {
  cmd: CommandItem;
  isSelected: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  onExecute: () => void;
  onHover: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onExecute}
      onMouseEnter={onHover}
      className={cn(
        "flex min-h-9 w-full items-center gap-3 px-3 py-1 text-left transition-colors",
        isSelected ? "bg-accent/70" : "hover:bg-accent/50",
      )}
    >
      <div className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
        <cmd.icon size={22} stroke={1.75} />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="truncate text-[15px] font-medium leading-5 text-foreground">
          {cmd.title}
        </div>
        {cmd.shortcut ? (
          <div className="ml-auto shrink-0 text-sm font-semibold leading-5 text-muted-foreground/60">
            {cmd.shortcut}
          </div>
        ) : null}
      </div>
    </button>
  );
}
