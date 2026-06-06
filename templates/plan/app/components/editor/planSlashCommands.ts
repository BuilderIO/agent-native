import type { BlockRegistry } from "@agent-native/core/blocks";
import type { SlashCommandItem } from "@agent-native/core/client";
import { createPlanBlockId } from "@shared/plan-content";
import { isNotionCompatibleBlockType } from "@shared/notion-compat";

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
 * shape the shared core {@link SlashCommandItem} contract expects
 * (`{ title, description, icon, action }` — `icon` is a short text glyph, and the
 * core `SlashCommandMenu` filters by `title`/`description`, so there is no
 * separate `keywords` field). `SharedRichEditor`/`RichMarkdownEditor` forward
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
  options: { notionCompatibleOnly?: boolean } = {},
): SlashCommandItem[] {
  const proseCommands: SlashCommandItem[] = [
    {
      title: "Text",
      description: "Plain text paragraph",
      icon: "T",
      action: (editor: SlashEditor) =>
        editor.chain().focus().setParagraph().run(),
    },
    {
      title: "Heading 1",
      description: "Large heading",
      icon: "H1",
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      title: "Heading 2",
      description: "Section heading",
      icon: "H2",
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      title: "Heading 3",
      description: "Subheading",
      icon: "H3",
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      title: "Bulleted list",
      description: "Unordered list",
      icon: "-",
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleBulletList().run(),
    },
    {
      title: "Numbered list",
      description: "Ordered list",
      icon: "1.",
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleOrderedList().run(),
    },
    {
      title: "To-do list",
      description: "Checklist items",
      icon: "[]",
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleTaskList().run(),
    },
    {
      title: "Quote",
      description: "Block quote",
      icon: '"',
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleBlockquote().run(),
    },
    {
      title: "Code block",
      description: "Code snippet",
      icon: "<>",
      action: (editor: SlashEditor) =>
        editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      title: "Divider",
      description: "Horizontal rule",
      icon: "—",
      action: (editor: SlashEditor) =>
        editor.chain().focus().setHorizontalRule().run(),
    },
    {
      title: "Table",
      description: "Three by three table",
      icon: "tbl",
      action: (editor: SlashEditor) =>
        (editor.chain().focus() as unknown as TableChain)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      title: "Image",
      description: "Insert an image",
      icon: "img",
      action: (editor: SlashEditor) =>
        editor
          .chain()
          .focus()
          .insertContent({ type: "image", attrs: { src: null, alt: "" } })
          .run(),
    },
  ];

  const blockCommands: SlashCommandItem[] = registry
    .list("block")
    // In Notion-compatible-only mode, hide blocks that can't round-trip to NFM.
    .filter(
      (spec) =>
        !options.notionCompatibleOnly || isNotionCompatibleBlockType(spec.type),
    )
    .map((spec) => ({
      title: spec.label,
      // The block `type` rides in the description so the core menu's
      // title/description substring filter matches typing the type keyword.
      description: spec.type,
      icon: spec.label.slice(0, 3),
      action: (editor: SlashEditor) =>
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
    }));

  return [...proseCommands, ...blockCommands];
}
