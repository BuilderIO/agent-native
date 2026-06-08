import type { Extension, Node, Mark } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { StarterKitOptions } from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";

/**
 * Shared lowlight instance for the editor's syntax-highlighted code blocks. A
 * curated grammar set (aliases like ts/tsx, js/jsx, html, sh, py, yml, md come
 * for free from each grammar) keeps the editor bundle lean while matching the
 * languages the read-side Shiki surfaces (`code-tabs`) support. highlight.js is
 * synchronous, which is what a live ProseMirror editor needs — Shiki is async
 * and only used for read-only render paths.
 */
const codeLowlight = createLowlight({
  bash,
  css,
  javascript,
  json,
  markdown,
  python,
  sql,
  typescript,
  xml,
  yaml,
});
import type { Doc as YDoc } from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { createImageExtension, type ImageUploadFn } from "./ImageExtension.js";
import { createCodeBlockNode } from "./CodeBlockNode.js";

/**
 * Markdown dialect the editor parses/serializes.
 *
 * - `gfm` — GitHub-Flavored Markdown. No raw HTML passthrough. The byte-stable
 *   serialization used by Plans (see RichMarkdownEditor.roundtrip.spec.ts).
 * - `nfm` — the Notion-Flavored Markdown superset used by the Content editor,
 *   which opts into inline HTML so Notion-specific blocks round-trip.
 */
export type RichMarkdownDialect = "gfm" | "nfm";

/**
 * Editor preset. Schema-neutral today (both presets share the base schema),
 * but threaded through so an app can branch schema/behavior per preset without
 * a new factory. The collab/markdown wiring is preset-independent.
 */
export type RichMarkdownEditorPreset = "plan" | "content";

/** User info used to label this client's collaborative cursor. */
export interface RichMarkdownCollabUser {
  name: string;
  color: string;
  email?: string;
}

/** Optional collaborative-editing inputs for the shared editor. */
export interface SharedEditorCollab {
  /**
   * Yjs document for collaborative editing. When present the editor binds the
   * shared {@link Collaboration} (+ {@link CollaborationCaret} when awareness
   * is set) extensions and StarterKit's built-in undo/redo is disabled (Yjs
   * owns history). When absent the editor is a controlled `value`/`onChange`
   * editor.
   */
  ydoc?: YDoc | null;
  /** Shared awareness instance for live multi-user cursors. */
  awareness?: Awareness | null;
  /** Current user info for the collaborative cursor label. */
  user?: RichMarkdownCollabUser | null;
}

/** Toggle the optional base extensions on/off per app. All default to `true`. */
export interface SharedEditorFeatures {
  /** GFM pipe tables (Table + TableRow + TableHeader + TableCell). */
  tables?: boolean;
  /** Task / checklist lists (TaskList + TaskItem). */
  tasks?: boolean;
  /** Inline links (the `Link` mark). When off, links fall back to plain text. */
  link?: boolean;
  /** Fenced code blocks. Disabling lets an app inject its own code-block node. */
  codeBlock?: boolean;
  /**
   * The built-in {@link Placeholder} extension. Default `true`. Apps that need a
   * bespoke placeholder resolver (per-node-type labels, ancestor-aware text)
   * disable this and supply their own Placeholder via `extraExtensions`.
   */
  placeholder?: boolean;
  /**
   * The built-in dialect-keyed {@link Markdown} serializer. Default `true`.
   * Apps with a custom serializer (e.g. Content's NFM converter, which does NOT
   * round-trip through tiptap-markdown's storage) disable this and own the
   * serialize/parse pipeline themselves. The Markdown extension is still added
   * so paste/clipboard transforms work — disable it only when supplying your own
   * Markdown configuration via the {@link CreateSharedEditorExtensionsOptions.markdown}
   * option instead.
   */
  markdown?: boolean;
  /**
   * The shared block-level image node (`@tiptap/extension-image`). Default
   * `false` so existing embedders are unchanged. When `true`, images
   * serialize to GFM `![alt](src)` (source-syncable) and — when an
   * {@link CreateSharedEditorExtensionsOptions.onImageUpload} function is
   * supplied — paste / drop of local image files uploads through it. Content
   * leaves this off and injects its own richer image node via
   * `extraExtensions`, so the two never collide.
   */
  image?: boolean;
}

export interface CreateSharedEditorExtensionsOptions {
  /** Markdown dialect; selects the keyed {@link Markdown} config. */
  dialect?: RichMarkdownDialect;
  /** Preset hook (schema-neutral today). */
  preset?: RichMarkdownEditorPreset;
  /** Empty-block placeholder text (headings get their own labels). */
  placeholder?: string;
  /** Toggle individual base extensions. */
  features?: SharedEditorFeatures;
  /**
   * Extra StarterKit options merged over the shared defaults. Lets an app turn
   * off StarterKit nodes it replaces (Content swaps in its own paragraph /
   * blockquote / code block) or pass a custom dropcursor, while still sharing
   * the rest of the StarterKit base + the collab undo/redo gating. The shared
   * defaults (`heading` levels 1-4, `link: false`, the default dropcursor, and
   * `undoRedo: false` in collab mode) are applied first and can be overridden
   * key-by-key here.
   */
  starterKit?: Partial<StarterKitOptions>;
  /**
   * Custom {@link Markdown} configuration. Replaces the dialect-keyed config from
   * {@link MARKDOWN_DIALECT_CONFIG} when provided. Only used when
   * `features.markdown !== false`; apps that own the whole markdown pipeline (no
   * tiptap-markdown serialization at all) should set `features.markdown: false`
   * and add their own configured Markdown extension via `extraExtensions`.
   */
  markdown?: Parameters<typeof Markdown.configure>[0];
  /**
   * App-specific extensions (Notion nodes, media, drag handles, comment
   * anchors, etc.) appended LAST so they bind over the shared base schema and
   * the optional Collaboration extensions still mount after them.
   */
  extraExtensions?: Array<Extension | Node | Mark>;
  /** Optional collaborative-editing wiring. */
  collab?: SharedEditorCollab | null;
  /**
   * Injectable image uploader for the shared image block. Only used when
   * `features.image` is on. Turns a picked / pasted / dropped image File into a
   * hosted `{ src, alt? }`. Plans pass `uploadEditorImage` (the framework
   * `upload-image` action). When omitted, the image block still renders and
   * round-trips `![alt](src)` markdown but cannot ingest local files.
   */
  onImageUpload?: ImageUploadFn | null;
}

/**
 * tiptap-markdown configuration, keyed by dialect. This is the single source of
 * truth for how each dialect parses/serializes markdown so the editor component
 * and the round-trip fidelity test can never drift apart.
 *
 * tiptap-markdown re-serializes the whole document on every edit, so the goal
 * for GFM is `serialize(parse(markdown)) === markdown` for the markdown plans
 * actually contain. We deliberately keep tiptap-markdown's own defaults
 * (`bulletListMarker: "-"`, `tightLists: true`, `linkify: false`,
 * `breaks: false`) because those produce the most byte-stable GFM. See
 * RichMarkdownEditor.roundtrip.spec.ts for the pinned corpus.
 *
 * NFM (Content) opts into inline HTML passthrough (`html: true`) so
 * Notion-specific blocks survive a markdown round-trip; the rest mirrors the
 * Content editor's existing `Markdown.configure` call.
 */
export const MARKDOWN_DIALECT_CONFIG: Record<
  RichMarkdownDialect,
  Parameters<typeof Markdown.configure>[0]
> = {
  gfm: {
    // GFM plans are the common case and must never gain raw HTML as a second
    // representation.
    html: false,
    // Keep tiptap-markdown's defaults that minimise first-edit normalisation
    // churn (see roundtrip spec). Listed explicitly so the contract is
    // self-documenting rather than relying on the package defaults.
    bulletListMarker: "-",
    tightLists: true,
    linkify: false,
    breaks: false,
    transformPastedText: true,
    transformCopiedText: true,
  },
  nfm: {
    // NFM is a superset that allows inline HTML so Notion blocks round-trip.
    html: true,
    transformPastedText: true,
    transformCopiedText: true,
  },
};

const DEFAULT_FEATURES: Required<SharedEditorFeatures> = {
  tables: true,
  tasks: true,
  link: true,
  codeBlock: true,
  placeholder: true,
  markdown: true,
  // Off by default: only Plans opt in today. Content injects its own richer
  // image node via `extraExtensions` and must not get a second `image` node.
  image: false,
};

/**
 * The ONE editor extension factory shared by every embedder (Plans today,
 * Content next). It assembles the base Tiptap schema (StarterKit + Placeholder
 * + Link + tasks + tables + code block), the dialect-keyed {@link Markdown}
 * serializer, the optional Collaboration stack, and finally any app-specific
 * `extraExtensions`.
 *
 * Ordering matters:
 *   1. Base schema (StarterKit first so its nodes/marks register; `starterKit`
 *      overrides let an app disable replaced nodes / swap the dropcursor).
 *   2. dialect-keyed Markdown serializer (suppressible via `features.markdown`
 *      for apps that own the whole serialize/parse pipeline, e.g. Content's NFM).
 *   3. `extraExtensions` (Notion/media/etc.) — appended before Collaboration so
 *      apps can extend the schema and Collaboration still binds over the full
 *      schema.
 *   4. Collaboration (+ CollaborationCaret) LAST so they bind over everything.
 *
 * Content (the NFM editor) drives this factory with `features.placeholder` and
 * `features.markdown` off, `features.tasks/tables/link` off where it ships its
 * own, a `starterKit` override disabling paragraph/blockquote/codeBlock, and all
 * Notion/media/fidelity nodes + its own Markdown(NFM)/Placeholder via
 * `extraExtensions` — so it shares the StarterKit base + the collab wiring while
 * owning its byte-identical NFM serializer.
 */
export function createSharedEditorExtensions({
  dialect = "gfm",
  // `preset` is accepted and forwarded for future preset-specific schema
  // branches; it is currently schema-neutral.
  preset: _preset = "plan",
  placeholder = "Type '/' for commands...",
  features,
  starterKit,
  markdown,
  extraExtensions = [],
  collab = null,
  onImageUpload = null,
}: CreateSharedEditorExtensionsOptions = {}): Array<Extension | Node | Mark> {
  const feat = { ...DEFAULT_FEATURES, ...(features ?? {}) };
  const ydoc = collab?.ydoc ?? null;
  const awareness = collab?.awareness ?? null;
  const user = collab?.user ?? null;

  const exts: Array<Extension | Node | Mark> = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: false,
      // StarterKit's plain code block is always disabled; when enabled we add the
      // syntax-highlighting `CodeBlockLowlight` (same `codeBlock` node) below.
      codeBlock: false,
      dropcursor: { color: "hsl(var(--ring))", width: 2 },
      // Yjs owns undo/redo when Collaboration is active; the StarterKit history
      // plugin and the CRDT cannot both track undo without corrupting state.
      ...(ydoc ? { undoRedo: false } : {}),
      // App overrides last so embedders can disable replaced nodes (paragraph,
      // blockquote, code block) or swap the dropcursor while keeping the shared
      // base + the collab undo/redo gating above.
      ...(starterKit ?? {}),
    }),
  ];

  // Notion-style syntax-highlighted code block (replaces StarterKit's plain one)
  // only when the embedder opts in via `features.codeBlock`. The shared node adds
  // a language picker header (Auto-detects by default) over `CodeBlockLowlight`,
  // so fenced markdown still round-trips byte-identically. Content disables this
  // and ships its own code node, so this affects Plans (and future opt-in apps)
  // alone.
  if (feat.codeBlock) {
    exts.push(createCodeBlockNode({ lowlight: codeLowlight }));
  }

  if (feat.placeholder) {
    exts.push(
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
    );
  }

  if (feat.link) {
    exts.push(
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "an-rich-md-link" },
      }),
    );
  }

  if (feat.tasks) {
    exts.push(
      TaskList.configure({
        HTMLAttributes: { class: "an-rich-md-task-list" },
      }),
      TaskItem.configure({ nested: true }),
    );
  }

  if (feat.tables) {
    exts.push(
      Table.configure({
        resizable: false,
        HTMLAttributes: { class: "an-rich-md-table" },
      }),
      TableRow,
      TableHeader,
      TableCell,
    );
  }

  if (feat.markdown) {
    exts.push(Markdown.configure(markdown ?? MARKDOWN_DIALECT_CONFIG[dialect]));
  }

  // Shared block-level image node. The node is named `image`, so when
  // `features.markdown` is on, tiptap-markdown serializes it through its
  // built-in `defaultMarkdownSerializer.nodes.image` fallback → `![alt](src)`
  // (no width-as-HTML override here, so GFM stays byte-stable and
  // source-syncable). With an `onImageUpload` it accepts paste/drop uploads.
  if (feat.image) {
    exts.push(createImageExtension({ onImageUpload }));
  }

  // App-specific extensions (Notion/media/drag handles/comments). Appended
  // before Collaboration so they can extend the schema and Collaboration binds
  // over the full set.
  if (extraExtensions.length > 0) {
    exts.push(...extraExtensions);
  }

  // Collaborative editing via the shared Y.Doc. Markdown stays the canonical
  // saved representation (onChange serializes it); the Y.Doc is transient live
  // state only. Appended last so it binds over the configured schema above.
  if (ydoc) {
    exts.push(Collaboration.configure({ document: ydoc }));
    // Live multi-user cursors. Only mounted alongside a Y.Doc so the standalone
    // controlled editor (today's plan/content behavior) is untouched.
    if (awareness) {
      exts.push(
        CollaborationCaret.configure({
          provider: { awareness },
          user: user ?? { name: "Anonymous", color: "#999" },
        }),
      );
    }
  }

  return exts;
}
