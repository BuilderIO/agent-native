import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import { cn } from "../utils.js";
import { agentNativePath } from "../api-path.js";
import type { Resource } from "./use-resources.js";
import {
  type ParsedFrontmatter,
  getRemoteAgentIdFromPath,
  getFrontmatterValue,
  isCustomAgentPath,
  isRemoteAgentPath,
  isSkillPath,
  parseFrontmatter,
  serializeFrontmatter,
} from "../../resources/metadata.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";

export interface ResourceEditorProps {
  resource: Resource;
  onSave: (content: string) => void;
  /** Controlled view mode — if provided, the editor won't manage its own view state */
  view?: "visual" | "code";
  onViewChange?: (v: "visual" | "code") => void;
  /** Called whenever save status changes */
  onSaveStatusChange?: (status: "idle" | "saving" | "saved") => void;
  /** When true, the editor's internal toolbar row is hidden */
  hideToolbar?: boolean;
}

const CONTROL_STYLE = { fontSize: 12, lineHeight: 1 } as const;

const VIEW_PREF_KEY = "resource-editor-view";

function getViewPref(): "visual" | "code" {
  try {
    const v = localStorage.getItem(VIEW_PREF_KEY);
    if (v === "code") return "code";
  } catch {}
  return "visual";
}

function setViewPref(v: "visual" | "code") {
  try {
    localStorage.setItem(VIEW_PREF_KEY, v);
  } catch {}
}

const FM_INPUT_STYLE: React.CSSProperties = {
  background: "transparent",
  border: "none",
  outline: "none",
  color: "inherit",
  fontSize: "inherit",
  fontFamily: "inherit",
  width: "100%",
  padding: 0,
};

function FrontmatterBar({
  resourcePath,
  frontmatter,
  onChange,
}: {
  resourcePath: string;
  frontmatter: ParsedFrontmatter;
  onChange: (updated: ParsedFrontmatter) => void;
}) {
  const getField = (key: string) => getFrontmatterValue(frontmatter, key) ?? "";

  const updateField = (key: string, value: string) => {
    const exists = frontmatter.fields.some((f) => f.key === key);
    const newFields = exists
      ? frontmatter.fields.map((f) => (f.key === key ? { ...f, value } : f))
      : [...frontmatter.fields, { key, value }];
    const updated: ParsedFrontmatter = {
      ...frontmatter,
      raw: serializeFrontmatter(newFields),
      fields: newFields,
    };
    onChange(updated);
  };

  const name = getField("name");
  const description = getField("description");
  const isUserInvocable = getField("user-invocable") === "true";
  const model = getField("model") || "inherit";
  const tools = getField("tools") || "inherit";
  const isCustomAgent = isCustomAgentPath(resourcePath);
  const isSkill = isSkillPath(resourcePath);

  return (
    <div
      style={{
        padding: "8px 12px",
        marginBottom: 8,
        borderRadius: 6,
        background: "hsl(var(--muted) / 0.5)",
        border: "1px solid hsl(var(--border) / 0.5)",
        fontSize: 12,
        lineHeight: 1.5,
        color: "hsl(var(--muted-foreground))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          value={name}
          onChange={(e) => updateField("name", e.target.value)}
          placeholder={isCustomAgent ? "Agent name" : "Skill name"}
          style={{
            ...FM_INPUT_STYLE,
            fontWeight: 600,
            color: "hsl(var(--foreground))",
            fontSize: 13,
            flex: 1,
          }}
        />
        {isSkill ? (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
              cursor: "pointer",
              whiteSpace: "nowrap",
              userSelect: "none",
              padding: "1px 5px",
              borderRadius: 3,
              background: isUserInvocable
                ? "hsl(var(--primary) / 0.15)"
                : "transparent",
              color: isUserInvocable
                ? "hsl(var(--primary))"
                : "hsl(var(--muted-foreground))",
              border: isUserInvocable
                ? "none"
                : "1px dashed hsl(var(--border))",
              fontWeight: 500,
            }}
          >
            <input
              type="checkbox"
              checked={isUserInvocable}
              onChange={(e) =>
                updateField(
                  "user-invocable",
                  e.target.checked ? "true" : "false",
                )
              }
              style={{ display: "none" }}
            />
            /{name || "command"}
          </label>
        ) : null}
        {isCustomAgent ? (
          <select
            value={model}
            onChange={(e) => updateField("model", e.target.value)}
            style={{
              borderRadius: 4,
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--background))",
              color: "hsl(var(--foreground))",
              fontSize: 11,
              padding: "2px 6px",
            }}
          >
            <option value="inherit">Default model</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
          </select>
        ) : null}
      </div>
      <input
        value={description}
        onChange={(e) => updateField("description", e.target.value)}
        placeholder={
          isCustomAgent
            ? "Description — what this agent should handle"
            : "Description — what this skill does"
        }
        style={{
          ...FM_INPUT_STYLE,
          marginTop: 2,
          opacity: 0.8,
          color: "hsl(var(--muted-foreground))",
        }}
      />
      {isCustomAgent ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 6,
            alignItems: "center",
          }}
        >
          <label
            style={{
              fontSize: 10,
              color: "hsl(var(--muted-foreground))",
              minWidth: 28,
            }}
          >
            Tools
          </label>
          <select
            value={tools}
            onChange={(e) => updateField("tools", e.target.value)}
            style={{
              borderRadius: 4,
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--background))",
              color: "hsl(var(--foreground))",
              fontSize: 11,
              padding: "2px 6px",
            }}
          >
            <option value="inherit">Inherit</option>
            <option value="allowlist">Allowlist later</option>
            <option value="denylist">Denylist later</option>
          </select>
        </div>
      ) : null}
    </div>
  );
}

// --- Slash Command Menu ---

interface CommandItem {
  title: string;
  description: string;
  icon: string;
  action: (editor: any) => void;
}

const slashCommands: CommandItem[] = [
  {
    title: "Text",
    description: "Plain text",
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
    description: "Medium heading",
    icon: "H2",
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Small heading",
    icon: "H3",
    action: (editor) =>
      editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Bullet List",
    description: "Unordered list",
    icon: "•",
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: "Numbered List",
    description: "Ordered list",
    icon: "1.",
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: "Code Block",
    description: "Code snippet",
    icon: "<>",
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: "Quote",
    description: "Block quote",
    icon: '"',
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    icon: "—",
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

function SlashMenu({ editor }: { editor: any }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    flipUp: boolean;
  } | null>(null);
  const slashPosRef = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const filteredCommands = useMemo(
    () =>
      slashCommands.filter(
        (cmd) =>
          cmd.title.toLowerCase().includes(query.toLowerCase()) ||
          cmd.description.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
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
        // Estimate menu height (~320px max) and check if it fits below
        const menuHeight = 320;
        const spaceBelow = window.innerHeight - coords.bottom;
        const flipUp = spaceBelow < menuHeight && coords.top > menuHeight;

        setPosition({
          top: flipUp ? coords.top : coords.bottom + 4,
          left: Math.min(coords.left, window.innerWidth - 240),
          flipUp,
        });
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

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        ...(position.flipUp
          ? { bottom: window.innerHeight - position.top + 4 }
          : { top: position.top }),
        left: position.left,
        zIndex: 9999,
      }}
      className="re-slash-menu"
    >
      <div className="py-1">
        <div
          style={{
            padding: "4px 10px",
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            opacity: 0.5,
          }}
        >
          Blocks
        </div>
        {filteredCommands.map((cmd, i) => (
          <button
            key={cmd.title}
            onClick={() => executeCommand(cmd)}
            onMouseEnter={() => setSelectedIndex(i)}
            className={cn(
              "re-slash-item",
              i === selectedIndex && "re-slash-item--active",
            )}
          >
            <span className="re-slash-icon">{cmd.icon}</span>
            <span>
              <span className="re-slash-title">{cmd.title}</span>
              <span className="re-slash-desc">{cmd.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Inline Bubble Toolbar ---

function InlineBubbleToolbar({ editor }: { editor: any }) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to } = editor.state.selection;
      if (from === to || !editor.isFocused) {
        setVisible(false);
        return;
      }
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) {
        setVisible(false);
        return;
      }
      const range = domSelection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0) {
        setVisible(false);
        return;
      }
      // Use fixed positioning with viewport coordinates
      setCoords({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
      setVisible(true);
    };
    editor.on("selectionUpdate", update);
    const onBlur = () => {
      // Delay so clicks on toolbar buttons register before hiding
      setTimeout(() => {
        if (!editor.isFocused) setVisible(false);
      }, 150);
    };
    editor.on("blur", onBlur);
    return () => {
      editor.off("selectionUpdate", update);
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
    const previousUrl = editor.getAttributes("link").href || "";
    setLinkUrl(previousUrl);
    setShowLinkInput(true);
  };

  const items = [
    {
      label: "B",
      title: "Bold",
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: () => editor.isActive("bold"),
      style: { fontWeight: 700 } as React.CSSProperties,
    },
    {
      label: "I",
      title: "Italic",
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: () => editor.isActive("italic"),
      style: { fontStyle: "italic" } as React.CSSProperties,
    },
    {
      label: "S",
      title: "Strikethrough",
      action: () => editor.chain().focus().toggleStrike().run(),
      isActive: () => editor.isActive("strike"),
      style: { textDecoration: "line-through" } as React.CSSProperties,
    },
    {
      label: "<>",
      title: "Code",
      action: () => editor.chain().focus().toggleCode().run(),
      isActive: () => editor.isActive("code"),
      style: { fontFamily: "monospace", fontSize: 11 } as React.CSSProperties,
    },
    { type: "divider" as const },
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
    { type: "divider" as const },
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
      ref={toolbarRef}
      className="re-bubble-toolbar"
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        transform: "translate(-50%, -100%)",
        zIndex: 9999,
      }}
    >
      {showLinkInput ? (
        <div
          style={{ display: "flex", alignItems: "center", gap: 4, padding: 4 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <input
            autoFocus
            type="url"
            placeholder="Paste link..."
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSetLink();
              if (e.key === "Escape") {
                setShowLinkInput(false);
                setLinkUrl("");
              }
            }}
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: "white",
              fontSize: 12,
              width: 160,
              padding: "2px 4px",
            }}
          />
          <button
            onClick={handleSetLink}
            style={{
              fontSize: 11,
              color: "#60a5fa",
              padding: "2px 6px",
              fontWeight: 500,
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            Apply
          </button>
        </div>
      ) : (
        <div
          style={{ display: "flex", alignItems: "center", gap: 2 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {items.map((item, i) => {
            if ("type" in item && item.type === "divider") {
              return (
                <div
                  key={`d-${i}`}
                  style={{
                    width: 1,
                    height: 16,
                    background: "rgba(255,255,255,0.2)",
                    margin: "0 2px",
                  }}
                />
              );
            }
            const { label, title, action, isActive, style } = item as {
              label: string;
              title: string;
              action: () => void;
              isActive: () => boolean;
              style?: React.CSSProperties;
            };
            return (
              <Tooltip key={title}>
                <TooltipTrigger asChild>
                  <button
                    onClick={action}
                    className={cn(
                      "re-bubble-btn",
                      isActive() && "re-bubble-btn--active",
                    )}
                    style={style}
                  >
                    {label}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{title}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Visual Markdown Editor ---

// --- Syntax-highlighted code editor (textarea + overlay) ---

function highlightJson(text: string): string {
  // Escape HTML first
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Tokenize JSON with regex
  return esc.replace(
    /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|((?:-?\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)/g,
    (match, key, str, num, lit) => {
      if (key) return `<span class="sh-key">${key}</span>:`;
      if (str) return `<span class="sh-str">${str}</span>`;
      if (num) return `<span class="sh-num">${num}</span>`;
      if (lit) return `<span class="sh-lit">${lit}</span>`;
      return match;
    },
  );
}

const shStyles = `
.sh-key { color: #7dd3fc; }
.sh-str { color: #86efac; }
.sh-num { color: #fca5a5; }
.sh-lit { color: #c4b5fd; }
`;

function SyntaxHighlightEditor({
  value,
  onChange,
  language: _language,
}: {
  value: string;
  onChange: (v: string) => void;
  language: "json";
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const highlighted = useMemo(() => highlightJson(value), [value]);

  const syncScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const monoFont =
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
  const sharedStyle: React.CSSProperties = {
    fontFamily: monoFont,
    fontSize: 13,
    lineHeight: 1.6,
    padding: 12,
    margin: 0,
    border: "none",
    whiteSpace: "pre",
    wordWrap: "normal",
    overflowWrap: "normal",
    tabSize: 2,
  };

  return (
    <>
      <style>{shStyles}</style>
      <div
        className="flex-1 min-h-0"
        style={{ position: "relative", overflow: "hidden" }}
      >
        <pre
          ref={preRef}
          aria-hidden
          style={{
            ...sharedStyle,
            position: "absolute",
            inset: 0,
            overflow: "auto",
            pointerEvents: "none",
            color: "hsl(var(--muted-foreground))",
            background: "transparent",
          }}
          dangerouslySetInnerHTML={{ __html: highlighted + "\n" }}
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          spellCheck={false}
          style={{
            ...sharedStyle,
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "auto",
            resize: "none",
            background: "transparent",
            color: "transparent",
            caretColor: "hsl(var(--foreground))",
            outline: "none",
            WebkitTextFillColor: "transparent",
          }}
        />
      </div>
    </>
  );
}

function VisualMarkdownEditor({
  content,
  onChange,
  resourcePath,
}: {
  content: string;
  onChange: (md: string) => void;
  resourcePath: string;
}) {
  const isSettingContent = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Parse frontmatter — strip it from tiptap content, re-prepend on save
  const parsed = useMemo(() => parseFrontmatter(content), [content]);
  const frontmatterRef = useRef(parsed);
  frontmatterRef.current = parsed;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: {},
        dropcursor: { color: "hsl(var(--ring))", width: 2 },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") {
            const level = node.attrs.level;
            if (level === 1) return "Heading 1";
            if (level === 2) return "Heading 2";
            return "Heading 3";
          }
          return "Type '/' for commands...";
        },
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "re-link" },
      }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: parsed?.body ?? content,
    editorProps: {
      attributes: {
        class: "re-prose",
      },
    },
    onUpdate: ({ editor }) => {
      if (isSettingContent.current) return;
      try {
        const md = (editor.storage as any).markdown.getMarkdown();
        // Re-prepend frontmatter if it existed
        const fm = frontmatterRef.current;
        const full = fm ? fm.raw + md : md;
        onChangeRef.current(full);
      } catch (err) {
        console.error("Markdown serialization error:", err);
      }
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const currentMd = (editor.storage as any).markdown.getMarkdown();
    if (currentMd !== (parsed?.body ?? content)) {
      if (editor.isFocused) return;
      isSettingContent.current = true;
      editor.commands.setContent(parsed?.body ?? content);
      isSettingContent.current = false;
    }
  }, [content, editor, parsed]);

  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  if (!editor) return null;

  const handleWrapperClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // If the click was on the wrapper (empty area), not on editor content, focus at end
    const target = e.target as HTMLElement;
    if (
      target.classList.contains("re-editor-clickable") ||
      target.classList.contains("re-editor-wrapper")
    ) {
      editor.chain().focus("end").run();
    }
  };

  return (
    <div
      className="re-editor-wrapper re-editor-clickable"
      onClick={handleWrapperClick}
      style={{ position: "relative", minHeight: "100%", cursor: "text" }}
    >
      {parsed && (
        <FrontmatterBar
          resourcePath={resourcePath}
          frontmatter={parsed}
          onChange={(updated) => {
            frontmatterRef.current = updated;
            // Get current body and combine with updated frontmatter
            try {
              const md = (editor.storage as any).markdown.getMarkdown();
              onChangeRef.current(updated.raw + md);
            } catch {
              // fallback
            }
          }}
        />
      )}
      <InlineBubbleToolbar editor={editor} />
      <SlashMenu editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

// --- Main ResourceEditor ---

interface RemoteAgentFormValue {
  id?: string;
  name: string;
  description: string;
  url: string;
  color: string;
}

function parseRemoteAgentContent(
  content: string,
  path: string,
): RemoteAgentFormValue {
  const fallbackId = getRemoteAgentIdFromPath(path);
  try {
    const data = JSON.parse(content || "{}");
    return {
      id: data.id || fallbackId,
      name: data.name ?? "",
      description: data.description ?? "",
      url: data.url ?? "",
      color: data.color ?? "#6B7280",
    };
  } catch {
    return {
      id: fallbackId,
      name: "",
      description: "",
      url: "",
      color: "#6B7280",
    };
  }
}

function serializeRemoteAgent(value: RemoteAgentFormValue): string {
  return (
    JSON.stringify(
      {
        id: value.id,
        name: value.name,
        description: value.description || undefined,
        url: value.url,
        color: value.color,
      },
      null,
      2,
    ) + "\n"
  );
}

function RemoteAgentFormEditor({
  resource,
  onChange,
}: {
  resource: Resource;
  onChange: (content: string) => void;
}) {
  const [value, setValue] = useState<RemoteAgentFormValue>(() =>
    parseRemoteAgentContent(resource.content, resource.path),
  );
  const prevIdRef = useRef(resource.id);

  useEffect(() => {
    if (prevIdRef.current !== resource.id) {
      setValue(parseRemoteAgentContent(resource.content, resource.path));
      prevIdRef.current = resource.id;
    }
  }, [resource.id, resource.content, resource.path]);

  const update = (patch: Partial<RemoteAgentFormValue>) => {
    const next = { ...value, ...patch };
    setValue(next);
    onChange(serializeRemoteAgent(next));
  };

  const inputClass =
    "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent";
  const labelClass = "block text-[11px] font-medium text-muted-foreground mb-1";

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-y-auto p-4">
      <div className="max-w-md space-y-3">
        <p className="text-[11px] text-muted-foreground/70 leading-snug">
          Connected remote agent over the A2A protocol. @-mention it in chat to
          delegate tasks.
        </p>
        <div>
          <label className={labelClass}>Name</label>
          <input
            className={inputClass}
            value={value.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Analytics"
          />
        </div>
        <div>
          <label className={labelClass}>URL</label>
          <input
            className={inputClass}
            value={value.url}
            onChange={(e) => update({ url: e.target.value })}
            placeholder="https://analytics.example.com"
          />
          <p className="mt-1 text-[10px] text-muted-foreground/50">
            A2A endpoint. The agent card is served at{" "}
            <code>/.well-known/agent-card.json</code>.
          </p>
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <textarea
            className={cn(inputClass, "resize-y")}
            rows={3}
            value={value.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="What this agent is good at — helps the main agent decide when to delegate."
          />
        </div>
        <div>
          <label className={labelClass}>Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value.color}
              onChange={(e) => update({ color: e.target.value })}
              className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
            />
            <input
              className={cn(inputClass, "flex-1")}
              value={value.color}
              onChange={(e) => update({ color: e.target.value })}
              placeholder="#6B7280"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ResourceEditor({
  resource,
  onSave,
  view: controlledView,
  onViewChange,
  onSaveStatusChange,
  hideToolbar,
}: ResourceEditorProps) {
  const [content, setContent] = useState(resource.content);
  const [internalView, setInternalView] = useState<"visual" | "code">(
    getViewPref,
  );
  const view = controlledView ?? internalView;
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevIdRef = useRef(resource.id);

  // Reset content when resource changes
  useEffect(() => {
    if (prevIdRef.current !== resource.id) {
      setContent(resource.content);
      setSaveStatus("idle");
      onSaveStatusChange?.("idle");
      prevIdRef.current = resource.id;
    }
  }, [resource.id, resource.content, onSaveStatusChange]);

  const handleChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      setSaveStatus("idle");
      onSaveStatusChange?.("idle");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setSaveStatus("saving");
        onSaveStatusChange?.("saving");
        onSave(newContent);
        setTimeout(() => {
          setSaveStatus("saved");
          onSaveStatusChange?.("saved");
        }, 300);
      }, 1000);
    },
    [onSave, onSaveStatusChange],
  );

  const switchView = useCallback(
    (v: "visual" | "code") => {
      setInternalView(v);
      setViewPref(v);
      onViewChange?.(v);
    },
    [onViewChange],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const isMarkdown =
    resource.mimeType === "text/markdown" || resource.path.endsWith(".md");
  const isImage = resource.mimeType.startsWith("image/");
  const isRemoteAgent = isRemoteAgentPath(resource.path);

  // Remote-agent manifest → form editor
  if (isRemoteAgent) {
    return (
      <div className="flex h-full flex-col">
        <RemoteAgentFormEditor resource={resource} onChange={handleChange} />
      </div>
    );
  }

  // Image preview
  if (isImage) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center overflow-auto p-4">
          <img
            src={agentNativePath(`/_agent-native/resources/${resource.id}?raw`)}
            alt={resource.path}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      </div>
    );
  }

  // Markdown files get visual/code toggle
  if (isMarkdown) {
    return (
      <div className="flex h-full flex-col">
        <style>{editorStyles}</style>
        {!hideToolbar && (
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-1">
              <button
                onClick={() => switchView("visual")}
                className={cn(
                  "rounded-md px-2 py-1.5 text-[12px] leading-none",
                  view === "visual"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                style={CONTROL_STYLE}
              >
                Visual
              </button>
              <button
                onClick={() => switchView("code")}
                className={cn(
                  "rounded-md px-2 py-1.5 text-[12px] leading-none",
                  view === "code"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                style={CONTROL_STYLE}
              >
                Code
              </button>
            </div>
            <span className="text-[11px] text-muted-foreground/60">
              {saveStatus === "saving"
                ? "Saving..."
                : saveStatus === "saved"
                  ? "Saved"
                  : ""}
            </span>
          </div>
        )}
        {view === "visual" ? (
          <div
            className="flex-1 min-h-0 overflow-y-auto p-3"
            key={resource.id + "-visual"}
          >
            <VisualMarkdownEditor
              content={content}
              onChange={handleChange}
              resourcePath={resource.path}
            />
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            className="flex-1 min-h-0 resize-none bg-transparent p-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50"
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              lineHeight: 1.6,
            }}
            spellCheck={false}
          />
        )}
      </div>
    );
  }

  // Non-markdown text files
  const isJson =
    resource.mimeType === "application/json" || resource.path.endsWith(".json");

  return (
    <div className="flex h-full flex-col">
      {isJson ? (
        <SyntaxHighlightEditor
          value={content}
          onChange={handleChange}
          language="json"
        />
      ) : (
        <textarea
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          className="flex-1 min-h-0 resize-none bg-transparent p-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50"
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            lineHeight: 1.6,
          }}
          spellCheck={false}
        />
      )}
    </div>
  );
}

// --- Scoped editor styles (injected inline so no external CSS needed) ---

const editorStyles = `
/* Prose styling for the visual editor */
.re-prose {
  outline: none;
  color: hsl(var(--foreground));
  line-height: 1.65;
  font-size: 13px;
  min-height: 100%;
}
.re-prose > *:first-child { margin-top: 0; }

.re-prose h1 {
  font-size: 1.5em;
  font-weight: 700;
  margin: 1em 0 0.25em;
  line-height: 1.25;
}
.re-prose h2 {
  font-size: 1.25em;
  font-weight: 600;
  margin: 0.8em 0 0.2em;
  line-height: 1.3;
}
.re-prose h3 {
  font-size: 1.1em;
  font-weight: 600;
  margin: 0.6em 0 0.15em;
  line-height: 1.35;
}
.re-prose p {
  margin: 0.35em 0;
  min-height: 1.65em;
}
.re-prose ul {
  list-style-type: disc;
  padding-left: 1.4em;
  margin: 0.2em 0;
}
.re-prose ol {
  list-style-type: decimal;
  padding-left: 1.4em;
  margin: 0.2em 0;
}
.re-prose li { margin: 0.05em 0; }
.re-prose li p { margin: 0; }

.re-prose blockquote {
  border-left: 2px solid hsl(var(--border));
  padding-left: 0.8em;
  margin: 0.3em 0;
  color: hsl(var(--muted-foreground));
}
.re-prose code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.88em;
  background: hsl(var(--muted));
  padding: 0.1em 0.3em;
  border-radius: 3px;
}
.re-prose pre {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  background: hsl(var(--muted));
  border-radius: 4px;
  padding: 0.7em 0.9em;
  margin: 0.3em 0;
  overflow-x: auto;
  line-height: 1.5;
}
.re-prose pre code {
  background: none;
  padding: 0;
  border: none;
  font-size: inherit;
}
.re-prose hr {
  border: none;
  border-top: 1px solid hsl(var(--border));
  margin: 1em 0;
}
.re-prose strong { font-weight: 600; }
.re-prose em { font-style: italic; }
.re-prose s { text-decoration: line-through; }

.re-link {
  color: hsl(var(--foreground));
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: hsl(var(--muted-foreground));
  cursor: pointer;
}
.re-link:hover {
  text-decoration-color: hsl(var(--foreground));
}

/* Placeholder */
.re-prose p.is-editor-empty:first-child::before,
.re-prose p.is-empty::before,
.re-prose h1.is-empty::before,
.re-prose h2.is-empty::before,
.re-prose h3.is-empty::before {
  content: attr(data-placeholder);
  float: left;
  color: hsl(var(--muted-foreground));
  opacity: 0.5;
  pointer-events: none;
  height: 0;
}

/* Selection */
.re-prose ::selection {
  background: hsl(210 100% 52% / 0.2);
}

/* Bubble toolbar */
.re-bubble-toolbar {
  display: flex;
  align-items: center;
  background: hsl(0 0% 15%);
  border-radius: 6px;
  padding: 3px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.25), 0 0 0 1px rgb(255 255 255 / 0.06);
}
.re-bubble-btn {
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 12px;
  color: rgba(255,255,255,0.75);
  background: none;
  border: none;
  cursor: pointer;
  line-height: 1;
}
.re-bubble-btn:hover {
  background: rgba(255,255,255,0.12);
  color: white;
}
.re-bubble-btn--active {
  background: rgba(255,255,255,0.18);
  color: white;
}

/* Slash command menu */
.re-slash-menu {
  background: hsl(var(--popover));
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  box-shadow: 0 4px 20px rgb(0 0 0 / 0.12), 0 0 0 1px rgb(0 0 0 / 0.04);
  min-width: 220px;
  max-height: 320px;
  overflow-y: auto;
  color: hsl(var(--foreground));
}
.re-slash-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  color: hsl(var(--foreground));
  font-size: 13px;
}
.re-slash-item:hover,
.re-slash-item--active {
  background: hsl(var(--accent));
}
.re-slash-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  flex-shrink: 0;
}
.re-slash-title {
  display: block;
  font-weight: 500;
  font-size: 13px;
}
.re-slash-desc {
  display: block;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
`;
