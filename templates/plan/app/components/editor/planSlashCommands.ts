import type { BlockRegistry } from "@agent-native/core/blocks";
import {
  buildRegistryBlockSlashItems,
  getRegistryBlockSlashDescription,
  getRegistryBlockSlashSearchText,
} from "@agent-native/toolkit/editor";
import type { SlashCommandItem } from "@agent-native/toolkit/editor";
import { isNotionCompatibleBlockType } from "@shared/notion-compat";
import { createPlanBlockId } from "@shared/plan-content";

type SlashEditor = Parameters<SlashCommandItem["action"]>[0];

type TableChain = {
  insertTable: (options: {
    rows: number;
    cols: number;
    withHeaderRow: boolean;
  }) => { run: () => boolean };
};

export function buildPlanSlashCommands(
  registry: BlockRegistry,
  options: {
    notionCompatibleOnly?: boolean;
    t?: (key: string) => string;
  } = {},
): SlashCommandItem[] {
  const label = (key: string, fallback: string) => options.t?.(key) ?? fallback;
  const proseCommands: SlashCommandItem[] = [
    {
      title: label("editor.slash.text.title", "Text"),
      description: label(
        "editor.slash.text.description",
        "Plain text paragraph",
      ),
      icon: "T",
      action: (editor: SlashEditor) =>
        editor.chain().focus().setParagraph().run(),
    },
    {
      title: label("editor.slash.heading1.title", "Heading 1"),
      description: label("editor.slash.heading1.description", "Large heading"),
      icon: "H1",
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      title: label("editor.slash.heading2.title", "Heading 2"),
      description: label(
        "editor.slash.heading2.description",
        "Section heading",
      ),
      icon: "H2",
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      title: label("editor.slash.heading3.title", "Heading 3"),
      description: label("editor.slash.heading3.description", "Subheading"),
      icon: "H3",
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      title: label("editor.slash.bulletedList.title", "Bulleted list"),
      description: label(
        "editor.slash.bulletedList.description",
        "Unordered list",
      ),
      icon: "-",
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleBulletList().run(),
    },
    {
      title: label("editor.slash.numberedList.title", "Numbered list"),
      description: label(
        "editor.slash.numberedList.description",
        "Ordered list",
      ),
      icon: "1.",
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleOrderedList().run(),
    },
    {
      title: label("editor.slash.todoList.title", "To-do list"),
      description: label(
        "editor.slash.todoList.description",
        "Checklist items",
      ),
      icon: "[]",
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleTaskList().run(),
    },
    {
      title: label("editor.slash.quote.title", "Quote"),
      description: label("editor.slash.quote.description", "Block quote"),
      icon: '"',
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleBlockquote().run(),
    },
    {
      title: label("editor.slash.codeBlock.title", "Code block"),
      description: label("editor.slash.codeBlock.description", "Code snippet"),
      icon: "<>",
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      title: label("editor.slash.divider.title", "Divider"),
      description: label("editor.slash.divider.description", "Horizontal rule"),
      icon: "—",
      action: (editor: SlashEditor) =>
        editor.chain().focus().setHorizontalRule().run(),
    },
    {
      title: label("editor.slash.table.title", "Table"),
      description: label(
        "editor.slash.table.description",
        "Three by three table",
      ),
      icon: "tbl",
      action: (editor: SlashEditor) =>
        (editor.chain().focus() as unknown as TableChain)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      title: label("editor.slash.image.title", "Image"),
      description: label("editor.slash.image.description", "Insert an image"),
      icon: "img",
      action: (editor: SlashEditor) =>
        editor
          .chain()
          .focus()
          .insertContent({ type: "image", attrs: { src: null, alt: "" } })
          .run(),
    },
  ];

  const blockCommands = buildRegistryBlockSlashItems<
    SlashCommandItem,
    SlashEditor
  >(registry, {
    notionCompatibleOnly: options.notionCompatibleOnly,
    isNotionCompatible: (spec) => isNotionCompatibleBlockType(spec.type),
    toItem: (spec, insert) => ({
      title:
        spec.type === "table"
          ? label("editor.slash.structuredTable.title", "Structured table")
          : spec.label,
      description: getRegistryBlockSlashDescription(spec),
      searchText: getRegistryBlockSlashSearchText(spec),
      icon: spec.label.slice(0, 3),
      action: insert,
    }),
    insertBlock: (editor, spec) =>
      editor
        .chain()
        .focus()
        .insertContent({
          type: "planBlock",
          attrs: {
            blockType: spec.type,
            blockId: createPlanBlockId(spec.type),
            title: null,
            summary: null,
          },
        })
        .run(),
  });

  return [...proseCommands, ...blockCommands];
}
