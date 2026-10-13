import type { Extension, Node, Mark } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import type { StarterKitOptions } from "@tiptap/starter-kit";
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
import { createLowlight } from "lowlight";
import { Markdown } from "tiptap-markdown";

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
import type { Awareness } from "y-protocols/awareness";
import type { Doc as YDoc } from "yjs";

import { createCodeBlockNode } from "./CodeBlockNode.js";
import { createImageExtension, type ImageUploadFn } from "./ImageExtension.js";
import { TaskListPasteNormalization } from "./TaskListPaste.js";

interface YSyncBindingWithInitialRender {
  beforeTransactionSelection: unknown;
  _forceRerender: () => void;
}

const CollaborationWithSafeInitialSelection = Collaboration.extend({
  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? [];

    for (const plugin of plugins) {
      const originalView = plugin.spec.view;
      if (!originalView) continue;

      plugin.spec.view = (view) => {
        const pluginState = plugin.getState(view.state) as
          | { binding?: YSyncBindingWithInitialRender }
          | undefined;
        const binding = pluginState?.binding;
        if (!binding || typeof binding._forceRerender !== "function") {
          return originalView(view);
        }

        const originalForceRerender = binding._forceRerender.bind(binding);
        binding._forceRerender = () => {
          const previousSelection = binding.beforeTransactionSelection;
          binding.beforeTransactionSelection ??= view.state.selection;
          try {
            originalForceRerender();
          } finally {
            binding.beforeTransactionSelection = previousSelection;
          }
        };

        try {
          return originalView(view);
        } finally {
          binding._forceRerender = originalForceRerender;
        }
      };
    }

    return plugins;
  },
});

export type RichMarkdownDialect = "gfm" | "nfm";

export type RichMarkdownEditorPreset = "plan" | "content";

export interface RichMarkdownCollabUser {
  name: string;
  color: string;
  email?: string;
}

export interface SharedEditorCollab {
  ydoc?: YDoc | null;
  awareness?: Awareness | null;
  user?: RichMarkdownCollabUser | null;
}

export interface SharedEditorFeatures {
  tables?: boolean;
  tasks?: boolean;
  link?: boolean;
  codeBlock?: boolean;
  placeholder?: boolean;
  markdown?: boolean;
  image?: boolean;
}

export interface CreateSharedEditorExtensionsOptions {
  dialect?: RichMarkdownDialect;
  preset?: RichMarkdownEditorPreset;
  placeholder?: string;
  features?: SharedEditorFeatures;
  starterKit?: Partial<StarterKitOptions>;
  markdown?: Parameters<typeof Markdown.configure>[0];
  extraExtensions?: Array<Extension | Node | Mark>;
  collab?: SharedEditorCollab | null;
  disableHistory?: boolean;
  onImageUpload?: ImageUploadFn | null;
}

export const MARKDOWN_DIALECT_CONFIG: Record<
  RichMarkdownDialect,
  Parameters<typeof Markdown.configure>[0]
> = {
  gfm: {
    html: false,
    bulletListMarker: "-",
    tightLists: true,
    linkify: false,
    breaks: false,
    transformPastedText: true,
    transformCopiedText: true,
  },
  nfm: {
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
  image: false,
};

export function createSharedEditorExtensions({
  dialect = "gfm",
  preset: _preset = "plan",
  placeholder = "Type '/' for commands...",
  features,
  starterKit,
  markdown,
  extraExtensions = [],
  collab = null,
  onImageUpload = null,
  disableHistory = false,
}: CreateSharedEditorExtensionsOptions = {}): Array<Extension | Node | Mark> {
  const feat = { ...DEFAULT_FEATURES, ...(features ?? {}) };
  const ydoc = collab?.ydoc ?? null;
  const awareness = collab?.awareness ?? null;
  const user = collab?.user ?? null;

  const exts: Array<Extension | Node | Mark> = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: false,
      codeBlock: false,
      dropcursor: { color: "hsl(var(--ring))", width: 2 },
      ...(ydoc || disableHistory ? { undoRedo: false } : {}),
      ...(starterKit ?? {}),
    }),
  ];

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
      TaskListPasteNormalization,
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

  if (feat.image) {
    exts.push(createImageExtension({ onImageUpload }));
  }

  if (extraExtensions.length > 0) {
    exts.push(...extraExtensions);
  }

  if (ydoc) {
    exts.push(
      CollaborationWithSafeInitialSelection.configure({ document: ydoc }),
    );
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
