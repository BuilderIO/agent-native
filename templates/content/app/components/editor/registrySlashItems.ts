import type { BlockRegistry, BlockSpec } from "@agent-native/core/blocks";
import {
  buildRegistryBlockSlashItems,
  getRegistryBlockSlashDescription,
  getRegistryBlockSlashSearchText,
} from "@agent-native/toolkit/editor";
import { serializeRegistryBlockToMdx } from "@shared/nfm-registry";
import { IconComponents } from "@tabler/icons-react";

import { createContentBlockId } from "./extensions/registryBlocks";

/**
 * Registry-derived slash command items for content's `SlashCommandMenu`.
 *
 * Content applies an explicit authoring policy to the shared registry. Blocks
 * remain registered for rendering and round-tripping even when they are absent
 * from the slash menu. Choosing an allowed item inserts a `registryBlock` atom
 * node seeded with a fresh `blockId` and the spec's `empty()` data.
 *
 * Content has NO sidecar block store: a registry block's authority is the inline
 * MDX preserved on the node as `__raw` (see `VisualEditor`'s `useRegistryBlockStore`).
 * So instead of seeding a separate side-map entry like plan does, we serialize the
 * spec's `empty()` data to its exact MDX element via the shared core serializer
 * and stamp it onto the node's `__raw`. The side-map's lazy `getBlock` then
 * hydrates the typed `data` from that `__raw` on first render — identical to how
 * a block loaded from a saved document hydrates — and the existing NFM save path
 * persists it verbatim. No new plumbing, byte-identical to a saved block.
 *
 * Notion gating: when `notionCompatibleOnly` is set (the open document is linked
 * to a Notion page), only specs that round-trip to Notion-Flavored Markdown
 * (`spec.notionCompatible`, the single registry-level allowlist from T3) are
 * offered, so authors can't add blocks that would silently drop on push. When it
 * is unset, Content's authorable registry blocks are offered.
 */

/** The shape content's `SlashCommandMenu` consumes (mirrors its `CommandItem`). */
export interface RegistrySlashItem {
  title: string;
  description: string;
  searchText?: string;
  icon: React.ElementType;
  action: (editor: RegistrySlashEditor) => void;
}

export interface ContentRegistrySlashPolicy {
  advancedCode?: boolean;
  layouts?: boolean;
  visuals?: boolean;
  developerDocs?: boolean;
}

const ALWAYS_HIDDEN_BLOCK_TYPES = new Set([
  "checklist",
  "table-block",
  "columns",
  "question-form",
  "visual-questions",
  "inline-database",
  "callout",
  "source-component",
  "builder-text",
  "builder-code-block",
  "builder-code-snippets-v2",
  "builder-tabbed-content",
  "builder-symbol",
  "builder-raw-block",
]);
const ADVANCED_CODE_BLOCK_TYPES = new Set(["code", "code-tabs"]);
const LAYOUT_BLOCK_TYPES = new Set(["custom-html", "tabs"]);
const VISUAL_BLOCK_TYPES = new Set(["diagram", "mermaid", "wireframe"]);
const DEVELOPER_DOC_BLOCK_TYPES = new Set([
  "api-endpoint",
  "openapi-spec",
  "data-model",
  "diff",
  "file-tree",
  "json-explorer",
  "annotated-code",
]);
export function contentRegistryBlockIsAuthorable(
  blockType: string,
  policy: ContentRegistrySlashPolicy = {},
) {
  if (ALWAYS_HIDDEN_BLOCK_TYPES.has(blockType)) return false;
  if (ADVANCED_CODE_BLOCK_TYPES.has(blockType)) return !!policy.advancedCode;
  if (LAYOUT_BLOCK_TYPES.has(blockType)) return !!policy.layouts;
  if (VISUAL_BLOCK_TYPES.has(blockType)) return !!policy.visuals;
  if (DEVELOPER_DOC_BLOCK_TYPES.has(blockType)) return !!policy.developerDocs;
  return false;
}

/**
 * The minimal Tiptap editor surface a registry slash item drives: a focus +
 * `insertContent` chain. Kept structural so this module needs no direct
 * `@tiptap/react` import beyond what `SlashCommandMenu` already pulls in.
 */
export interface RegistrySlashEditor {
  chain: () => {
    focus: () => {
      insertContent: (content: unknown) => { run: () => boolean };
    };
  };
}

/**
 * Serialize a spec's `empty()` seed to its inline MDX element so a freshly
 * inserted `registryBlock` node carries the same `__raw` a saved block would.
 * Returns an empty string when the spec has no `empty()` factory (the side-map
 * then shows its loading placeholder until edited), or when serialization fails
 * for an unexpected reason — never throws into the insert path.
 */
export function seedRegistryBlockRaw(spec: BlockSpec, blockId: string): string {
  if (!spec.empty) return "";
  try {
    return serializeRegistryBlockToMdx(spec.type, {
      id: blockId,
      data: spec.empty(),
    });
  } catch {
    return "";
  }
}

/**
 * Build Content's policy-filtered registry slash items. The caller supplies
 * evaluated Labs settings; unknown types fail closed.
 */
export function buildRegistrySlashItems(
  registry: BlockRegistry,
  options: {
    notionCompatibleOnly?: boolean;
    policy?: ContentRegistrySlashPolicy;
  } = {},
): RegistrySlashItem[] {
  // The shared builder owns registry enumeration and Notion compatibility.
  // Content owns which registered formats are offered for new insertion.
  return buildRegistryBlockSlashItems<
    RegistrySlashItem,
    RegistrySlashEditor,
    BlockSpec
  >(registry, {
    notionCompatibleOnly: options.notionCompatibleOnly,
    includeSpec: (spec) =>
      contentRegistryBlockIsAuthorable(spec.type, options.policy),
    toItem: (spec, insert) => ({
      title: spec.label,
      description: getRegistryBlockSlashDescription(spec),
      searchText: getRegistryBlockSlashSearchText(spec),
      icon: (spec.icon ?? IconComponents) as React.ElementType,
      action: insert,
    }),
    insertBlock: (editor, spec) => {
      const blockId = createContentBlockId(spec.type);
      editor
        .chain()
        .focus()
        .insertContent({
          type: "registryBlock",
          attrs: {
            blockType: spec.type,
            blockId,
            title: null,
            summary: null,
            __raw: seedRegistryBlockRaw(spec, blockId),
          },
        })
        .run();
    },
  });
}
