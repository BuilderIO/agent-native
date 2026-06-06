import { IconComponents } from "@tabler/icons-react";
import type { BlockRegistry, BlockSpec } from "@agent-native/core/blocks";
import { buildRegistryBlockSlashItems } from "@agent-native/core/client";
import { serializeRegistryBlockToMdx } from "@shared/nfm-registry";
import { createContentBlockId } from "./extensions/registryBlocks";

/**
 * Registry-derived slash command items for content's `SlashCommandMenu`.
 *
 * Every `BlockSpec` whose `placement` includes `"block"` (the shared dev-doc /
 * OpenAPI / structured library plan and content both register) becomes one slash
 * item. Choosing it inserts a `registryBlock` atom node — the SAME core node plan
 * inserts a `planBlock` for — seeded with a fresh `blockId` and the spec's
 * `empty()` data.
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
 * is unset, all registry blocks are offered.
 */

/** The shape content's `SlashCommandMenu` consumes (mirrors its `CommandItem`). */
export interface RegistrySlashItem {
  title: string;
  description: string;
  icon: React.ElementType;
  action: (editor: RegistrySlashEditor) => void;
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
 * Build the registry-derived slash items from a content `BlockRegistry`. APPEND
 * the result to content's hand-authored slash list (Notion toggle/callout/table/
 * headings stay first); these add the structured-block library beneath them.
 */
export function buildRegistrySlashItems(
  registry: BlockRegistry,
  options: { notionCompatibleOnly?: boolean } = {},
): RegistrySlashItem[] {
  // Registry block commands come from the shared core builder so adding a library
  // block only touches the registry. Content's per-app parts: a React-component
  // `icon`, the `description + type` keyword string, the default
  // `spec.notionCompatible` gating predicate, and inserting a `registryBlock`
  // node seeded with inline `__raw`.
  return buildRegistryBlockSlashItems<RegistrySlashItem, RegistrySlashEditor>(
    registry,
    {
      notionCompatibleOnly: options.notionCompatibleOnly,
      toItem: (spec, insert) => ({
        title: spec.label,
        // The block `type` rides in the description (alongside the human
        // description) so the menu's title/description substring filter also
        // matches typing the raw type keyword (e.g. "/file-tree").
        description: `${spec.description} ${spec.type}`,
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
    },
  );
}
