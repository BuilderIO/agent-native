import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";
import { cn } from "../utils.js";

export type RichMarkdownDialect = "gfm" | "nfm";
export type RichMarkdownEditorPreset = "plan" | "content";

export interface CreateRichMarkdownExtensionsOptions {
  dialect?: RichMarkdownDialect;
  placeholder?: string;
}

/**
 * The single source of truth for the editor's schema + markdown serializer
 * configuration. Both the {@link RichMarkdownEditor} component and the
 * round-trip fidelity test build their `Editor` from this so the markdown
 * dialect they parse/serialize can never drift apart.
 *
 * tiptap-markdown re-serializes the whole document on every edit, so the goal
 * here is to keep `serialize(parse(markdown)) === markdown` for the markdown
 * plans actually contain. We deliberately keep tiptap-markdown's own defaults
 * (`bulletListMarker: "-"`, `tightLists: true`, `linkify: false`,
 * `breaks: false`) because those produce the most byte-stable GFM. See
 * RichMarkdownEditor.roundtrip.spec.ts for the pinned corpus.
 */
export function createRichMarkdownExtensions({
  dialect = "gfm",
  placeholder = "Type '/' for commands...",
}: CreateRichMarkdownExtensionsOptions = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: false,
      dropcursor: { color: "hsl(var(--ring))", width: 2 },
    }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === "heading") {
          const level = node.attrs.level;
          if (level === 1) return "Heading 1";
          if (level === 2) return "Heading 2";
          if (level === 3) return "Heading 3";
          return "Heading 4";
        }
        return placeholder;
      },
      showOnlyWhenEditable: true,
      showOnlyCurrent: true,
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: "an-rich-md-link" },
    }),
    TaskList.configure({
      HTMLAttributes: { class: "an-rich-md-task-list" },
    }),
    TaskItem.configure({ nested: true }),
    Table.configure({
      resizable: false,
      HTMLAttributes: { class: "an-rich-md-table" },
    }),
    TableRow,
    TableHeader,
    TableCell,
    Markdown.configure({
      // GFM plans are the common case and must never gain raw HTML as a second
      // representation; NFM presets opt into inline HTML passthrough.
      html: dialect === "nfm",
      // Keep tiptap-markdown's defaults that minimise first-edit normalisation
      // churn (see roundtrip spec). Listed explicitly so the contract is
      // self-documenting rather than relying on the package defaults.
      bulletListMarker: "-",
      tightLists: true,
      linkify: false,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ];
}

export interface RichMarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  contentUpdatedAt?: string | null;
  editable?: boolean;
  dialect?: RichMarkdownDialect;
  preset?: RichMarkdownEditorPreset;
  placeholder?: string;
  className?: string;
  editorClassName?: string;
  interactive?: boolean;
}

type CommandItem = {
  title: string;
  description: string;
  icon: string;
  action: (editor: Editor) => void;
};

const slashCommands: CommandItem[] = [
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

function getMarkdown(editor: Editor): string {
  const markdownStorage = editor.storage as unknown as {
    markdown?: { getMarkdown?: () => string };
  };
  return markdownStorage.markdown?.getMarkdown?.() ?? "";
}

export function RichMarkdownEditor({
  value,
  onChange,
  onBlur,
  contentUpdatedAt,
  editable = true,
  dialect = "gfm",
  preset = "plan",
  placeholder = "Type '/' for commands...",
  className,
  editorClassName,
  interactive = editable,
}: RichMarkdownEditorProps) {
  const isSettingContent = useRef(false);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const lastEmittedRef = useRef("");
  const lastTypedAtRef = useRef(0);
  const lastAppliedUpdatedAtRef = useRef<string | null>(
    contentUpdatedAt ?? null,
  );
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;

  const extensions = useMemo(
    () => createRichMarkdownExtensions({ dialect, placeholder }),
    // `preset` is retained in the dependency list so future preset-specific
    // schema branches re-create the editor; it is currently schema-neutral.
    [dialect, placeholder, preset],
  );

  const editor = useEditor({
    extensions,
    content: value,
    editable,
    editorProps: {
      attributes: {
        class: cn("an-rich-md-prose", editorClassName),
      },
    },
    onUpdate: ({ editor }) => {
      if (!editable || isSettingContent.current) return;
      lastTypedAtRef.current = Date.now();
      try {
        const markdown = getMarkdown(editor);
        lastEmittedRef.current = markdown;
        queueMicrotask(() => onChangeRef.current(markdown));
      } catch (error) {
        console.error("Markdown serialization error:", error);
      }
    },
    onBlur: () => {
      onBlurRef.current?.();
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const apply = () => {
      if (cancelled || editor.isDestroyed) return;
      const currentMarkdown = getMarkdown(editor);
      if (currentMarkdown === value || value === lastEmittedRef.current) {
        if (contentUpdatedAt) {
          lastAppliedUpdatedAtRef.current = contentUpdatedAt;
        }
        return;
      }

      const externalNewer =
        !lastAppliedUpdatedAtRef.current ||
        !contentUpdatedAt ||
        contentUpdatedAt > lastAppliedUpdatedAtRef.current;
      const typingRecently =
        editor.isFocused && Date.now() - lastTypedAtRef.current < 1500;
      if (externalNewer && typingRecently) {
        retry = setTimeout(apply, 700);
        return;
      }
      if (!externalNewer && editor.isFocused) return;

      queueMicrotask(() => {
        if (cancelled || editor.isDestroyed) return;
        isSettingContent.current = true;
        editor.commands.setContent(value, {
          emitUpdate: false,
          parseOptions: { preserveWhitespace: "full" },
        });
        isSettingContent.current = false;
        if (contentUpdatedAt) {
          lastAppliedUpdatedAtRef.current = contentUpdatedAt;
        }
      });
    };

    apply();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [contentUpdatedAt, editor, value]);

  useEffect(() => () => editor?.destroy(), [editor]);

  const handleWrapperClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editable || !editor || editor.isDestroyed) return;
    const target = event.target as HTMLElement;
    if (
      target.classList.contains("an-rich-md-wrapper") ||
      target.classList.contains("an-rich-md-clickable")
    ) {
      editor.chain().focus("end").run();
    }
  };

  if (!editor) {
    return (
      <div
        className={cn("an-rich-md-wrapper an-rich-md-loading", className)}
        data-plan-interactive={interactive ? true : undefined}
      />
    );
  }

  return (
    <div
      className={cn(
        "an-rich-md-wrapper an-rich-md-clickable",
        !editable && "an-rich-md-wrapper--readonly",
        className,
      )}
      onClick={handleWrapperClick}
      data-plan-interactive={interactive ? true : undefined}
    >
      {editable ? <RichMarkdownBubbleToolbar editor={editor} /> : null}
      {editable ? <RichMarkdownSlashMenu editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}

function RichMarkdownSlashMenu({ editor }: { editor: Editor }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    flipUp: boolean;
  } | null>(null);
  const slashPosRef = useRef<number | null>(null);

  const filteredCommands = useMemo(
    () =>
      slashCommands.filter(
        (cmd) =>
          cmd.title.toLowerCase().includes(query.toLowerCase()) ||
          cmd.description.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    slashPosRef.current = null;
  }, []);

  const executeCommand = useCallback(
    (command: CommandItem) => {
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
        setSelectedIndex((index) => (index + 1) % filteredCommands.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
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
    const handleTransaction = () => {
      const { state } = editor;
      const { from } = state.selection;
      const textBefore = state.doc.textBetween(
        Math.max(0, from - 32),
        from,
        "\n",
      );
      const slashMatch = textBefore.match(/\/([a-zA-Z0-9]*)$/);
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
          <span>
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

function RichMarkdownBubbleToolbar({ editor }: { editor: Editor }) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  useEffect(() => {
    const update = () => {
      const { from, to } = editor.state.selection;
      if (from === to || !editor.isFocused) {
        setVisible(false);
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        setVisible(false);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setVisible(false);
        return;
      }
      setCoords({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
      setVisible(true);
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    const onBlur = () => {
      setTimeout(() => {
        if (!editor.isFocused) setVisible(false);
      }, 140);
    };
    editor.on("blur", onBlur);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      editor.off("blur", onBlur);
    };
  }, [editor]);

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
    setLinkUrl(editor.getAttributes("link").href || "");
    setShowLinkInput(true);
  };

  const items: Array<
    | {
        label: string;
        title: string;
        action: () => void;
        isActive: () => boolean;
        style?: CSSProperties;
      }
    | { type: "divider" }
  > = [
    {
      label: "B",
      title: "Bold",
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: () => editor.isActive("bold"),
      style: { fontWeight: 700 },
    },
    {
      label: "I",
      title: "Italic",
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: () => editor.isActive("italic"),
      style: { fontStyle: "italic" },
    },
    {
      label: "S",
      title: "Strikethrough",
      action: () => editor.chain().focus().toggleStrike().run(),
      isActive: () => editor.isActive("strike"),
      style: { textDecoration: "line-through" },
    },
    {
      label: "<>",
      title: "Code",
      action: () => editor.chain().focus().toggleCode().run(),
      isActive: () => editor.isActive("code"),
      style: { fontFamily: "monospace", fontSize: 11 },
    },
    { type: "divider" },
    {
      label: "H1",
      title: "Heading 1",
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: () => editor.isActive("heading", { level: 1 }),
    },
    {
      label: "H2",
      title: "Heading 2",
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: () => editor.isActive("heading", { level: 2 }),
    },
    {
      label: "H3",
      title: "Heading 3",
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: () => editor.isActive("heading", { level: 3 }),
    },
    { type: "divider" },
    {
      label: "Link",
      title: "Link",
      action: toggleLink,
      isActive: () => editor.isActive("link"),
    },
  ];

  if (!visible) return null;

  return (
    <div
      className="an-rich-md-bubble-toolbar"
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        transform: "translate(-50%, -100%)",
      }}
      onMouseDown={(event) => event.preventDefault()}
      data-plan-interactive
    >
      {showLinkInput ? (
        <div className="an-rich-md-link-editor">
          <input
            autoFocus
            type="url"
            placeholder="Paste link..."
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSetLink();
              if (event.key === "Escape") {
                setShowLinkInput(false);
                setLinkUrl("");
              }
            }}
          />
          <button type="button" onClick={handleSetLink}>
            Apply
          </button>
        </div>
      ) : (
        <div className="an-rich-md-bubble-items">
          {items.map((item, index) => {
            if ("type" in item) {
              return (
                <span
                  key={`divider-${index}`}
                  className="an-rich-md-bubble-divider"
                />
              );
            }
            return (
              <button
                key={item.title}
                type="button"
                title={item.title}
                className={cn(
                  "an-rich-md-bubble-button",
                  item.isActive() && "an-rich-md-bubble-button--active",
                )}
                style={item.style}
                onClick={item.action}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
