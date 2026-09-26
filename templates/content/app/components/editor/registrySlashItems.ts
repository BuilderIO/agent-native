import type { BlockRegistry, BlockSpec } from "@agent-native/core/blocks";
import {
  buildRegistryBlockSlashItems,
  getRegistryBlockSlashDescription,
  getRegistryBlockSlashSearchText,
} from "@agent-native/toolkit/editor";
import { serializeRegistryBlockToMdx } from "@shared/nfm-registry";
import { IconComponents } from "@tabler/icons-react";

import { createContentBlockId } from "./extensions/registryBlocks";

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

export interface RegistrySlashEditor {
  chain: () => {
    focus: () => {
      insertContent: (content: unknown) => { run: () => boolean };
    };
  };
}

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

export function buildRegistrySlashItems(
  registry: BlockRegistry,
  options: {
    notionCompatibleOnly?: boolean;
    policy?: ContentRegistrySlashPolicy;
  } = {},
): RegistrySlashItem[] {
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
