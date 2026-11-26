import { isListItem } from "@agent-native/toolkit/editor";
import { INTERACTIVE_HTML_LANGUAGE } from "@shared/interactive-html-language";
import { registryBlockSpecByType } from "@shared/nfm-registry";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

import {
  isInteractiveHtmlCodeBlock,
  isMermaidCodeBlock,
} from "./extensions/CodeBlockNode";
import { toggleTitleNode } from "./extensions/NotionExtensions";
import {
  getTableHeaders,
  setTableFitWidth,
  setTableHeaders,
} from "./table-commands";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface BlockAt {
  node: ProseMirrorNode;
  pos: number;
}

/** A setting of one kind of block, which its menu shows as a switch. */
export interface BlockMenuSwitch {
  id: string;
  label: string;
  checked: boolean;
  /** Flips the setting on the block as it is when the switch runs. */
  toggle: (tr: Transaction, block: BlockAt) => void;
}

/** What the block menu knows about one kind of block. */
export interface BlockMenuEntry {
  /** The menu's title: the kind of block, as the slash menu names it. */
  title: (node: ProseMirrorNode, t: Translate) => string;
  /** Turn into can make it another kind of block, or only some blocks of it. */
  turnInto?: boolean | ((node: ProseMirrorNode) => boolean);
  /** Its own settings, which suggested edits can't change. */
  switches?: (node: ProseMirrorNode, t: Translate) => BlockMenuSwitch[];
}

const titled =
  (key: string): BlockMenuEntry["title"] =>
  (_node, t) =>
    t(key);

// Notion blocks Content keeps as they are, by the tag they came with.
const NOTION_BLOCK_TITLES: Partial<Record<string, string>> = {
  page: "editor.slash.page",
  database: "editor.slash.database",
  equation: "editor.slash.blockEquation",
  file: "editor.blockMenu.file",
  pdf: "editor.blockMenu.pdf",
  bookmark: "editor.blockMenu.bookmark",
  embed: "editor.blockMenu.embed",
  table_of_contents: "editor.blockMenu.tableOfContents",
  synced_block: "editor.blockMenu.syncedBlock",
  synced_block_reference: "editor.blockMenu.syncedBlock",
};

function tableSwitches(node: ProseMirrorNode, t: Translate): BlockMenuSwitch[] {
  const headers = getTableHeaders(node);
  return [
    {
      id: "header-row",
      label: t("database.headerRow"),
      checked: headers.row,
      toggle: (tr, table) =>
        setTableHeaders(tr, table, { row: !getTableHeaders(table.node).row }),
    },
    {
      id: "header-column",
      label: t("database.headerColumn"),
      checked: headers.column,
      toggle: (tr, table) =>
        setTableHeaders(tr, table, {
          column: !getTableHeaders(table.node).column,
        }),
    },
    {
      id: "fit-to-width",
      label: t("database.fitToWidth"),
      checked: node.attrs.fitPageWidth === true,
      toggle: (tr, table) =>
        setTableFitWidth(tr, table, table.node.attrs.fitPageWidth !== true),
    },
  ];
}

function codeBlockSwitches(
  node: ProseMirrorNode,
  t: Translate,
): BlockMenuSwitch[] {
  const interactive = isInteractiveHtmlCodeBlock(node);
  if (!interactive && node.attrs.language !== "html") return [];
  return [
    {
      id: "interactive-html",
      label: t("editor.interactiveHtml.runsOnPage"),
      checked: interactive,
      toggle: (tr, block) =>
        tr.setNodeAttribute(
          block.pos,
          "language",
          isInteractiveHtmlCodeBlock(block.node)
            ? "html"
            : INTERACTIVE_HTML_LANGUAGE,
        ),
    },
  ];
}

/**
 * Every kind of block a page can hold, by node type. A kind with no entry
 * gets a menu titled "Block"; the registry's test fails until it has one.
 */
export const BLOCK_MENU_ENTRIES: Record<string, BlockMenuEntry> = {
  paragraph: { title: titled("editor.slash.text"), turnInto: true },
  heading: {
    title: (node, t) => t(`editor.heading${node.attrs.level}`),
    turnInto: true,
  },
  bulletList: { title: titled("editor.slash.bulletedList") },
  orderedList: { title: titled("editor.slash.numberedList") },
  taskList: { title: titled("editor.slash.todoList") },
  listItem: { title: titled("editor.slash.bulletedList"), turnInto: true },
  taskItem: { title: titled("editor.slash.todoList"), turnInto: true },
  blockquote: { title: titled("editor.slash.quote") },
  codeBlock: {
    title: (node, t) =>
      t(
        isMermaidCodeBlock(node)
          ? "editor.mermaid.source"
          : isInteractiveHtmlCodeBlock(node)
            ? "editor.slash.interactiveHtml"
            : "editor.slash.codeBlock",
      ),
    switches: codeBlockSwitches,
  },
  horizontalRule: { title: titled("editor.slash.divider") },
  image: { title: titled("editor.slash.image") },
  video: { title: titled("editor.slash.video") },
  audio: { title: titled("editor.slash.audio") },
  table: { title: titled("editor.slash.table"), switches: tableSwitches },
  notionCallout: { title: titled("editor.slash.callout") },
  // Turn into works from a Toggle's title line, which Toggles saved before
  // their titles became page text don't have.
  notionToggle: {
    title: titled("editor.slash.toggle"),
    turnInto: (node) => !!toggleTitleNode(node),
  },
  notionColumns: { title: titled("editor.blockMenu.columns") },
  notionSyncedBlock: { title: titled("editor.blockMenu.syncedBlock") },
  notionBlockAtom: {
    title: (node, t) =>
      t(NOTION_BLOCK_TITLES[node.attrs.tagName] ?? "editor.blockMenu.block"),
  },
  registryBlock: {
    title: (node, t) =>
      node.attrs.blockType === "source-component"
        ? t("editor.sourceComponent.defaultTitle")
        : (registryBlockSpecByType(node.attrs.blockType)?.label ??
          t("editor.blockMenu.block")),
  },
  contentReference: { title: titled("editor.reference.defaultTitle") },
  localMdxComponent: { title: titled("editor.blockMenu.component") },
};

const UNKNOWN_BLOCK: BlockMenuEntry = {
  title: titled("editor.blockMenu.block"),
};

export function blockMenuEntry(node: ProseMirrorNode): BlockMenuEntry {
  return BLOCK_MENU_ENTRIES[node.type.name] ?? UNKNOWN_BLOCK;
}

/** The menu's title for a block. A list item is titled by its list's kind. */
export function blockMenuTitle(
  node: ProseMirrorNode,
  parent: ProseMirrorNode | null,
  t: Translate,
): string {
  const named = isListItem(node) && parent ? parent : node;
  return blockMenuEntry(named).title(named, t);
}
