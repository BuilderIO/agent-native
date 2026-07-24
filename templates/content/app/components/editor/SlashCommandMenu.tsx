import { useSendToAgentChat } from "@agent-native/core/client/agent-chat";
import { PromptComposer } from "@agent-native/core/client/composer";
import { useT } from "@agent-native/core/client/i18n";
import type { CreateInlineDatabaseResponse } from "@shared/api";
import { renderMathToHtml } from "@shared/math-rendering";
import { collapseExactRepeatedNfm, docToNfm } from "@shared/nfm";
import { serializeRegistryBlockToMdx } from "@shared/nfm-registry";
import {
  IconCheck,
  IconTypography,
  IconH1,
  IconH2,
  IconH3,
  IconH4,
  IconH5,
  IconH6,
  IconList,
  IconListNumbers,
  IconSquareCheck,
  IconChevronRight,
  IconCode,
  IconMinus,
  IconTable as TableIcon,
  IconHierarchy2,
  IconInfoCircle,
  IconMusic,
  IconPhoto,
  IconFileText,
  IconDatabase,
  IconVideo,
  IconMathFunction,
  IconSquareRoot2,
} from "@tabler/icons-react";
import { Editor } from "@tiptap/react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { contentBlockRegistry } from "@/blocks/contentBlockRegistry";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCreateInlineContentDatabase } from "@/hooks/use-content-database";
import { useCreatePage } from "@/hooks/use-create-page";
import { cn } from "@/lib/utils";
import { localContentComponents } from "@/local-components";

import { focusMostRecentEmptyToggleSummary } from "./extensions/NotionExtensions";
import { buildLocalComponentSlashItems } from "./localComponentSlashItems";
import { MathRenderer } from "./MathRenderer";
import { buildRegistrySlashItems } from "./registrySlashItems";

interface SlashCommandMenuProps {
  editor: Editor;
  documentId?: string;
  onDraftCommitted?: () => void | Promise<void>;
  onDraftPersisted?: (markdown: string) => boolean | Promise<boolean>;
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

interface EquationDraft {
  displayMode: boolean;
  insertionRange: { from: number; to: number };
  slashRange: { from: number; to: number };
  position: EditorMenuPosition;
}

export interface CommandItem {
  title: string;
  description: string;
  searchText?: string;
  shortcut?: string;
  icon: React.ElementType;
  preserveSlashRange?: boolean;
  action: (
    editor: Editor,
    context: { slashRange: { from: number; to: number } | null },
  ) => void | boolean | Promise<void>;
}

function getActiveSlashCommandRange(editor: Editor) {
  const { state } = editor;
  if (!state.selection.empty) return null;
  const { from, $from } = state.selection;
  if (!$from.parent.isTextblock) return null;

  const blockStart = $from.start();
  const textBefore = state.doc.textBetween(blockStart, from, "\n");
  const slashQuery = parseSlashCommandQuery(textBefore);
  if (slashQuery === null) return null;

  const slashIndex = textBefore.lastIndexOf("/");
  return {
    from: blockStart + slashIndex,
    to: from,
  };
}

function waitForEditorUpdateFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export interface CommandTemplate extends Omit<
  CommandItem,
  "title" | "description"
> {
  titleKey: string;
  descriptionKey: string;
}

export const CONTENT_HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

const headingCommandMetadata = [
  {
    level: 1,
    titleKey: "editor.heading1",
    descriptionKey: "editor.slash.heading1Description",
    shortcut: "#",
    icon: IconH1,
  },
  {
    level: 2,
    titleKey: "editor.heading2",
    descriptionKey: "editor.slash.heading2Description",
    shortcut: "##",
    icon: IconH2,
  },
  {
    level: 3,
    titleKey: "editor.heading3",
    descriptionKey: "editor.slash.heading3Description",
    shortcut: "###",
    icon: IconH3,
  },
  {
    level: 4,
    titleKey: "editor.heading4",
    descriptionKey: "editor.slash.heading4Description",
    shortcut: "####",
    icon: IconH4,
  },
  {
    level: 5,
    titleKey: "editor.heading5",
    descriptionKey: "editor.slash.heading5Description",
    shortcut: "#####",
    icon: IconH5,
  },
  {
    level: 6,
    titleKey: "editor.heading6",
    descriptionKey: "editor.slash.heading6Description",
    shortcut: "######",
    icon: IconH6,
  },
] as const satisfies ReadonlyArray<{
  level: (typeof CONTENT_HEADING_LEVELS)[number];
  titleKey: string;
  descriptionKey: string;
  shortcut: string;
  icon: React.ElementType;
}>;

export function buildHeadingCommands(
  behavior: "toggle" | "set",
): CommandTemplate[] {
  return headingCommandMetadata.map((heading) => ({
    ...heading,
    action: (editor) => {
      const chain = editor.chain().focus();
      return behavior === "toggle"
        ? chain.toggleHeading({ level: heading.level }).run()
        : chain.setHeading({ level: heading.level }).run();
    },
  }));
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

export function parseSlashCommandQuery(textBeforeCursor: string) {
  const match = textBeforeCursor.match(
    /^\s*\/([a-zA-Z0-9][a-zA-Z0-9 _-]*|)\s*$/,
  );
  if (!match) return null;
  const rawQuery = match[1] ?? "";
  // `/generate <prompt>` intentionally leaves the menu so Enter can submit the
  // inline prompt. Other multi-word labels (for example `/heading 2`) remain
  // searchable instead of turning into literal editor text at the first space.
  if (/^generate\s+/i.test(rawQuery)) return null;
  return rawQuery.trim();
}

export function inlineDatabaseBlockContent(
  block: CreateInlineDatabaseResponse["block"],
) {
  return {
    type: "registryBlock",
    attrs: {
      blockType: "inline-database",
      blockId: block.ownerBlockId,
      title: null,
      summary: null,
      __raw: serializeRegistryBlockToMdx("inline-database", {
        id: block.ownerBlockId,
        data: block,
      }),
    },
  };
}

export function insertInlineDatabaseBlock(
  editor: Editor,
  block: CreateInlineDatabaseResponse["block"],
  position?: number | { from: number; to: number } | null,
) {
  const content = inlineDatabaseBlockContent(block);
  const chain = editor.chain().focus();
  return position != null
    ? chain.insertContentAt(position, content).run()
    : chain.insertContent(content).run();
}

export function equationNodeContent(latex: string, displayMode: boolean) {
  return displayMode
    ? {
        type: "notionBlockAtom",
        attrs: { tagName: "equation", attrsJson: "{}", label: latex },
      }
    : {
        type: "notionInlineAtom",
        attrs: { tagName: "math", attrsJson: "{}", label: latex },
      };
}

export function insertEquation(
  editor: Editor,
  latex: string,
  displayMode: boolean,
  range: { from: number; to: number },
) {
  const content = equationNodeContent(latex, displayMode);
  return editor
    .chain()
    .focus()
    .insertContentAt(
      range,
      displayMode ? [content, { type: "paragraph" }] : content,
    )
    .run();
}

export function getEquationInsertionRange(
  editor: Editor,
  slashRange: { from: number; to: number },
  displayMode: boolean,
) {
  if (!displayMode) return slashRange;
  const resolved = editor.state.doc.resolve(slashRange.from);
  return resolved.parent.isTextblock
    ? { from: resolved.before(), to: resolved.after() }
    : slashRange;
}

export function setCodeBlockFromSlashCommand(
  editor: Editor,
  slashRange: { from: number; to: number } | null,
) {
  const chain = editor.chain().focus();
  if (slashRange) chain.deleteRange(slashRange);
  return chain.setCodeBlock().run();
}

const commands: CommandTemplate[] = [
  {
    titleKey: "editor.slash.text",
    descriptionKey: "editor.slash.textDescription",
    icon: IconTypography,
    action: setPlainTextBlock,
  },
  ...buildHeadingCommands("toggle"),
  {
    titleKey: "editor.slash.bulletedList",
    descriptionKey: "editor.slash.bulletedListDescription",
    shortcut: "-",
    icon: IconList,
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    titleKey: "editor.slash.numberedList",
    descriptionKey: "editor.slash.numberedListDescription",
    shortcut: "1.",
    icon: IconListNumbers,
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    titleKey: "editor.slash.todoList",
    descriptionKey: "editor.slash.todoListDescription",
    shortcut: "[]",
    icon: IconSquareCheck,
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    titleKey: "editor.slash.toggle",
    descriptionKey: "editor.slash.toggleDescription",
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
    titleKey: "editor.slash.codeBlock",
    descriptionKey: "editor.slash.codeBlockDescription",
    shortcut: "```",
    icon: IconCode,
    preserveSlashRange: true,
    action: (editor, { slashRange }) =>
      setCodeBlockFromSlashCommand(editor, slashRange),
  },
  {
    titleKey: "editor.slash.quote",
    descriptionKey: "editor.slash.quoteDescription",
    shortcut: '"',
    icon: QuoteCommandIcon,
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    titleKey: "editor.slash.callout",
    descriptionKey: "editor.slash.calloutDescription",
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
    titleKey: "editor.slash.divider",
    descriptionKey: "editor.slash.dividerDescription",
    shortcut: "---",
    icon: IconMinus,
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    titleKey: "editor.slash.table",
    descriptionKey: "editor.slash.tableDescription",
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
const turnIntoCommands: CommandTemplate[] = [
  {
    titleKey: "editor.slash.text",
    descriptionKey: "editor.slash.textDescription",
    icon: IconTypography,
    action: setPlainTextBlock,
  },
  ...buildHeadingCommands("set"),
  {
    titleKey: "editor.slash.bulletedList",
    descriptionKey: "editor.slash.bulletedListDescription",
    shortcut: "-",
    icon: IconList,
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    titleKey: "editor.slash.numberedList",
    descriptionKey: "editor.slash.numberedListDescription",
    shortcut: "1.",
    icon: IconListNumbers,
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    titleKey: "editor.slash.todoList",
    descriptionKey: "editor.slash.todoListDescription",
    shortcut: "[]",
    icon: IconSquareCheck,
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    titleKey: "editor.slash.toggle",
    descriptionKey: "editor.slash.collapsibleBlockDescription",
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
    titleKey: "editor.slash.codeBlock",
    descriptionKey: "editor.slash.codeBlockDescription",
    shortcut: "```",
    icon: IconCode,
    preserveSlashRange: true,
    action: (editor, { slashRange }) =>
      setCodeBlockFromSlashCommand(editor, slashRange),
  },
  {
    titleKey: "editor.slash.quote",
    descriptionKey: "editor.slash.quoteDescription",
    shortcut: '"',
    icon: QuoteCommandIcon,
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    titleKey: "editor.slash.callout",
    descriptionKey: "editor.slash.calloutDescription",
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
  onDraftCommitted,
  onDraftPersisted,
}: SlashCommandMenuProps) {
  const t = useT();
  const { send, isGenerating } = useSendToAgentChat();
  const navigate = useNavigate();
  const createPage = useCreatePage({ navigate: false, awaitPersist: true });
  const createInlineDatabase = useCreateInlineContentDatabase(
    documentId ?? null,
  );

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
  const [generatePos, setGeneratePos] = useState<EditorMenuPosition | null>(
    null,
  );

  const [equationDraft, setEquationDraft] = useState<EquationDraft | null>(
    null,
  );
  const [equationLatex, setEquationLatex] = useState("");
  const equationInputRef = useRef<HTMLTextAreaElement>(null);
  const equationResult = useMemo(
    () => renderMathToHtml(equationLatex, equationDraft?.displayMode ?? false),
    [equationDraft?.displayMode, equationLatex],
  );

  const submitGeneratePrompt = useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      if (!documentId) {
        toast.error(t("editor.noDocumentSelected"));
        return;
      }
      setGenerateOpen(false);
      const content = (editor.storage as any).markdown.getMarkdown();
      send({
        message: trimmed,
        context: `The user is asking you to generate content for their document (id: ${documentId}). Use the update-document action to write the generated markdown content. Do NOT use db-exec or raw SQL - use \`update-document --id ${documentId} --content "..."\` (and \`--title\` if appropriate).${content ? `\n\nCurrent document content:\n${content}` : "\n\nThe document is currently empty."}`,
        submit: true,
      });
    },
    [documentId, editor, send, t],
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
      setGenerateOpen(true);
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
    title: t("editor.slash.generate"),
    description: t("editor.slash.generateDescription"),
    icon: IconHierarchy2,
    action: () => {
      openGeneratePopover(position);
    },
  };

  const imageCommand: CommandItem = {
    title: t("editor.slash.image"),
    description: t("editor.slash.imageDescription"),
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
    title: t("editor.slash.video"),
    description: t("editor.slash.videoDescription"),
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
    title: t("editor.slash.audio"),
    description: t("editor.slash.audioDescription"),
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
    title: t("editor.slash.page"),
    description: t("editor.slash.pageDescription"),
    icon: IconFileText,
    preserveSlashRange: true,
    action: async (_editor, { slashRange }) => {
      if (!documentId) {
        toast.error(t("editor.noDocumentSelected"));
        return;
      }
      let pageId: string;
      try {
        pageId = await createPage(documentId);
      } catch {
        return;
      }
      const pageReference = {
        type: "notionBlockAtom",
        attrs: {
          tagName: "page",
          attrsJson: JSON.stringify({
            id: pageId,
          }),
          label: "Untitled",
        },
      };
      const insertContent = [pageReference, { type: "paragraph" }];
      const range = slashRange
        ? (() => {
            const $from = editor.state.doc.resolve(slashRange.from);
            return $from.parent.isTextblock
              ? { from: $from.before(), to: $from.after() }
              : slashRange;
          })()
        : null;

      if (range) {
        editor.chain().focus().insertContentAt(range, insertContent).run();
      } else {
        const { $from } = editor.state.selection;
        editor
          .chain()
          .focus()
          .insertContentAt($from.after(), insertContent)
          .run();
      }
      await waitForEditorUpdateFrame();
      try {
        const content = collapseExactRepeatedNfm(
          docToNfm(editor.getJSON() as any),
          {
            requiredText: `id="${pageId}"`,
          },
        );
        if (onDraftPersisted) {
          const persisted = await onDraftPersisted(content);
          if (!persisted) throw new Error(t("empty.genericError"));
        } else {
          await onDraftCommitted?.();
        }
      } catch (error) {
        toast.error(t("editor.failedToCreatePage"), {
          description:
            error instanceof Error ? error.message : t("empty.genericError"),
        });
        return;
      }
      navigate(`/page/${pageId}`, { flushSync: true });
    },
  };

  const databaseCommand: CommandItem = {
    title: t("editor.slash.database"),
    description: t("editor.slash.databaseDescription"),
    icon: IconDatabase,
    preserveSlashRange: true,
    action: async (editor, { slashRange }) => {
      if (!documentId) {
        toast.error(t("editor.noDocumentSelected"));
        return;
      }
      if (slashRange) {
        editor.chain().focus().deleteRange(slashRange).run();
      }
      const toastId = toast.loading(t("editor.creatingDatabase"));
      try {
        const result = await createInlineDatabase.mutateAsync({
          hostDocumentId: documentId,
          title: t("editor.untitledDatabase"),
        });
        const inserted = insertInlineDatabaseBlock(editor, result.block);
        if (!inserted) throw new Error(t("empty.genericError"));
        await waitForEditorUpdateFrame();
        const content = collapseExactRepeatedNfm(
          docToNfm(editor.getJSON() as any),
          {
            requiredText: result.block.ownerBlockId,
          },
        );
        if (onDraftPersisted) {
          const persisted = await onDraftPersisted(content);
          if (!persisted) throw new Error(t("empty.genericError"));
        } else {
          await onDraftCommitted?.();
        }
        toast.success(t("editor.databaseCreated"), { id: toastId });
      } catch (error) {
        toast.error(t("editor.failedToCreateDatabase"), {
          id: toastId,
          description:
            error instanceof Error ? error.message : t("empty.genericError"),
        });
      }
    },
  };

  const openEquationComposer = useCallback(
    (displayMode: boolean, slashRange: { from: number; to: number } | null) => {
      const menuPosition = position ?? getSelectionMenuPosition();
      if (!slashRange || !menuPosition) return false;
      setEquationLatex("");
      setEquationDraft({
        displayMode,
        slashRange,
        insertionRange: getEquationInsertionRange(
          editor,
          slashRange,
          displayMode,
        ),
        position: menuPosition,
      });
      setTimeout(() => equationInputRef.current?.focus(), 0);
      return true;
    },
    [editor, getSelectionMenuPosition, position],
  );

  const cancelEquation = useCallback(() => {
    const draft = equationDraft;
    setEquationDraft(null);
    setEquationLatex("");
    if (draft) {
      editor.chain().focus().deleteRange(draft.slashRange).run();
    }
  }, [editor, equationDraft]);

  const submitEquation = useCallback(() => {
    if (!equationDraft || !equationResult.ok) return;
    const latex = equationLatex.trim();
    const { displayMode, insertionRange } = equationDraft;
    setEquationDraft(null);
    setEquationLatex("");
    const inserted = insertEquation(editor, latex, displayMode, insertionRange);
    if (!inserted) {
      toast.error(t("editor.slash.equationInsertFailed"));
      return;
    }
    void onDraftCommitted?.();
  }, [
    editor,
    equationDraft,
    equationLatex,
    equationResult.ok,
    onDraftCommitted,
    t,
  ]);

  const equationCommands: CommandItem[] = isTurnInto
    ? []
    : [
        {
          title: t("editor.slash.blockEquation"),
          description: t("editor.slash.blockEquationDescription"),
          searchText: "latex katex math formula",
          icon: IconMathFunction,
          preserveSlashRange: true,
          action: (_editor, { slashRange }) =>
            openEquationComposer(true, slashRange),
        },
        {
          title: t("editor.slash.inlineEquation"),
          description: t("editor.slash.inlineEquationDescription"),
          searchText: "latex katex math formula",
          icon: IconSquareRoot2,
          preserveSlashRange: true,
          action: (_editor, { slashRange }) =>
            openEquationComposer(false, slashRange),
        },
      ];

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
        : (buildLocalComponentSlashItems(localContentComponents, {
            description: t("editor.localMdxComponent"),
          }) as unknown as CommandItem[]),
    [isTurnInto, t],
  );

  const aiCommands = isTurnInto ? [] : [generateCommand];
  const localizeCommand = (cmd: CommandTemplate): CommandItem => ({
    ...cmd,
    title: t(cmd.titleKey),
    description: t(cmd.descriptionKey),
  });
  const blockCommands = [
    ...(isTurnInto ? turnIntoCommands : commands).map(localizeCommand),
    ...equationCommands,
  ];
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

  const executeCommand = useCallback(
    async (cmd: CommandItem) => {
      if (editor.isDestroyed) return;
      const slashRange =
        getActiveSlashCommandRange(editor) ??
        (slashPosRef.current !== null
          ? { from: slashPosRef.current, to: editor.state.selection.from }
          : null);
      if (slashRange && !cmd.preserveSlashRange) {
        editor.chain().focus().deleteRange(slashRange).run();
      }
      setIsOpen(false);
      setIsTurnInto(false);
      setQuery("");
      slashPosRef.current = null;
      await cmd.action(editor, { slashRange });
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) {
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
        e.stopPropagation();
        if (filteredCommands.length === 0) return;
        setSelectedIndex((i) => (i + 1) % filteredCommands.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (filteredCommands.length === 0) return;
        setSelectedIndex(
          (i) => (i - 1 + filteredCommands.length) % filteredCommands.length,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (filteredCommands[selectedIndex]) {
          executeCommand(filteredCommands[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.stopPropagation();
        setIsOpen(false);
        setIsTurnInto(false);
        setQuery("");
        slashPosRef.current = null;
        onDraftCommitted?.();
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
    onDraftCommitted,
    onDraftPersisted,
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
                  {isTurnInto
                    ? t("editor.slash.turnInto")
                    : t("editor.slash.basicBlocks")}
                </div>
                {filteredBlockCommands.map(renderCommand)}
              </>
            ) : null}
            {filteredRegistryCommands.length > 0 ? (
              <>
                <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
                  {t("editor.slash.blocks")}
                </div>
                {filteredRegistryCommands.map(renderCommand)}
              </>
            ) : null}
            {filteredLocalComponentCommands.length > 0 ? (
              <>
                <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
                  {t("editor.slash.localComponents")}
                </div>
                {filteredLocalComponentCommands.map(renderCommand)}
              </>
            ) : null}
            {filteredMediaCommands.length > 0 ? (
              <>
                <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
                  {t("editor.slash.media")}
                </div>
                {filteredMediaCommands.map(renderCommand)}
              </>
            ) : null}
            {filteredPageCommands.length > 0 ? (
              <>
                <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
                  {t("editor.slash.pages")}
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
            className="w-[calc(100vw-2rem)] p-3 sm:w-[420px]"
          >
            <p className="px-1 pb-2 text-sm font-semibold text-foreground">
              {t("editor.generateWithAi")}
            </p>
            <PromptComposer
              autoFocus
              disabled={isGenerating}
              placeholder={t("editor.describeWhatToGenerate")}
              draftScope={`content:generate:${documentId ?? "document"}`}
              onSubmit={submitGeneratePrompt}
            />
          </PopoverContent>
        </Popover>
      )}

      {equationDraft && (
        <Popover
          open
          onOpenChange={(open: boolean) => {
            if (!open) cancelEquation();
          }}
        >
          <PopoverTrigger asChild>
            <span
              className="pointer-events-none absolute size-0"
              style={{
                top: equationDraft.position.top,
                left: Math.min(equationDraft.position.left, 16),
              }}
            />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="bottom"
            className="w-[calc(100vw-2rem)] max-w-md rounded-xl p-0"
            onOpenAutoFocus={(event: Event) => {
              event.preventDefault();
              equationInputRef.current?.focus();
            }}
          >
            <div className="p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {equationDraft.displayMode ? (
                  <IconMathFunction
                    className="text-muted-foreground"
                    size={16}
                  />
                ) : (
                  <IconSquareRoot2
                    className="text-muted-foreground"
                    size={16}
                  />
                )}
                {equationDraft.displayMode
                  ? t("editor.slash.blockEquation")
                  : t("editor.slash.inlineEquation")}
              </div>
              <textarea
                ref={equationInputRef}
                value={equationLatex}
                onChange={(event) => setEquationLatex(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey) &&
                    equationResult.ok
                  ) {
                    event.preventDefault();
                    submitEquation();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEquation();
                  }
                }}
                rows={equationDraft.displayMode ? 3 : 2}
                placeholder={t("editor.slash.equationPlaceholder")}
                aria-label={t("editor.slash.equationInputLabel")}
                aria-invalid={equationLatex.length > 0 && !equationResult.ok}
                aria-describedby="equation-preview-status"
                className="mt-3 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="mt-3 min-h-20 rounded-lg border border-border bg-muted/30 p-3">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("editor.slash.equationPreview")}
                </div>
                <div className="flex min-h-9 items-center justify-center overflow-x-auto text-foreground">
                  {equationResult.ok ? (
                    <MathRenderer
                      latex={equationLatex}
                      displayMode={equationDraft.displayMode}
                    />
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {equationLatex
                        ? t("editor.slash.equationNeedsRepair")
                        : t("editor.slash.equationPreviewEmpty")}
                    </span>
                  )}
                </div>
              </div>
              <p
                id="equation-preview-status"
                className={cn(
                  "mt-2 min-h-5 text-xs",
                  equationLatex && !equationResult.ok
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {equationLatex && !equationResult.ok
                  ? equationResult.error
                  : t("editor.slash.equationSubmitHint")}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <Button variant="ghost" size="sm" onClick={cancelEquation}>
                {t("editor.slash.cancelEquation")}
              </Button>
              <Button
                size="sm"
                onClick={submitEquation}
                disabled={!equationResult.ok}
              >
                <IconCheck />
                {t("editor.slash.insertEquation")}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}

export function CommandButton({
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
  const pendingExecutionRef = useRef(false);
  const onExecuteRef = useRef(onExecute);
  onExecuteRef.current = onExecute;

  const executeOnce = () => {
    if (pendingExecutionRef.current) return;
    pendingExecutionRef.current = true;
    // Pointer selection can close and unmount the menu before the browser
    // dispatches `click`. Start the command during mouse down, while the
    // editor selection and button are both still alive. Keep `onClick` as the
    // keyboard-generated click fallback and dedupe the normal pointer click.
    onExecuteRef.current();
    queueMicrotask(() => {
      pendingExecutionRef.current = false;
    });
  };

  return (
    <button
      ref={buttonRef}
      onMouseDown={(event) => {
        event.preventDefault();
        if (event.button === 0) executeOnce();
      }}
      onClick={executeOnce}
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
