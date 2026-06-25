import type { BlockRegistry } from "@agent-native/core/blocks";
import {
  buildRegistryBlockSlashItems,
  getRegistryBlockSlashDescription,
  getRegistryBlockSlashSearchText,
  type SlashCommandItem,
} from "@agent-native/core/client";
import { isNotionCompatibleBlockType } from "@shared/notion-compat";
import { createPlanBlockId } from "@shared/plan-content";

/**
 * The Tiptap editor handed to a slash command's `action`. Derived from the core
 * {@link SlashCommandItem} contract instead of importing `@tiptap/react`
 * directly, so this file carries no extra tiptap dependency (the plan template
 * uses tiptap transitively through `@agent-native/core/client`).
 */
type SlashEditor = Parameters<SlashCommandItem["action"]>[0];

/**
 * The `insertTable` command is contributed by `@tiptap/extension-table`, which
 * the shared editor registers at runtime but whose `ChainedCommands` type
 * augmentation is not visible from this template (it has no direct tiptap
 * dependency — tiptap is transitive through `@agent-native/core/client`). This
 * narrow shape re-adds just that one command signature so the Table slash item
 * stays type-safe without importing tiptap here.
 */
type TableChain = {
  insertTable: (options: {
    rows: number;
    cols: number;
    withHeaderRow: boolean;
  }) => { run: () => boolean };
};

/**
 * Build the plan document editor's slash command list, returned in the exact
 * shape the shared core {@link SlashCommandItem} contract expects. `icon` is a
 * short text glyph; `description` is compact visible copy; `searchText` carries
 * raw block types and aliases. `SharedRichEditor`/`RichMarkdownEditor` forward
 * this array to `SlashCommandMenu` via its `items` prop.
 *
 * Two tiers of commands:
 *  - Base prose commands (Text, Headings, lists, quote, code, divider, table,
 *    image) drive standard Tiptap chains — mirroring the content app's slash set
 *    but emitting the core menu item type.
 *  - Registry block commands are derived from every `BlockSpec` whose
 *    `placement` includes `"block"`. Each inserts a `planBlock` node referencing
 *    the spec by `blockType` with a freshly minted `blockId`. The editor seeds
 *    `blocks[]` from `spec.empty()` when a new `planBlock` id first appears, so
 *    no block `data` is seeded here.
 */
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

  // Registry block commands come from the shared core builder so adding a library
  // block only touches the registry. Plan's per-app parts: a text-glyph `icon`,
  // compact visible descriptions, hidden search text for type/alias matching,
  // the union Notion-compat predicate (which also covers prose-only NFM analogs),
  // and inserting a `planBlock` node.
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
