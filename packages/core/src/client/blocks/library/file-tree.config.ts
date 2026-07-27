import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the PLAN-SPECIFIC `file-tree` block: its data schema
 * and MDX round-trip config. Shared by the server MDX adapter (`plan-mdx.ts` via
 * `plan-block-registry.ts`) and the client spec (`planBlocks.tsx`). Keeping this
 * React-free means importing it into a server module never pulls React into the
 * Nitro/SSR bundle.
 *
 * The block renders a VS Code / GitHub-explorer style file/change tree: a flat
 * list of `entries` (each a slash-delimited `path` with an optional change kind,
 * note, and code snippet) from which the RENDERER derives the nested folder tree
 * — the model never carries the folder structure, only the leaf paths. This keeps
 * the data lean and the tree always consistent with the paths.
 *
 * The schema MUST stay data-compatible with the `file-tree` member of
 * `planBlockSchema` (`plan-content.ts`), and the MDX `tag` (`FileTree`) +
 * attribute shape MUST match it so stored `.mdx` round-trips: the whole `entries`
 * array is one JSON prop (`<FileTree id … title entries={…} />`).
 */

/** The kind of change applied to a file, driving its change badge. */
export type FileTreeChange = "added" | "modified" | "removed" | "renamed";

export const FILE_TREE_CHANGES: FileTreeChange[] = [
  "added",
  "modified",
  "removed",
  "renamed",
];

/**
 * One file in the tree. `path` is slash-delimited (`src/routes/git.ts`); the
 * renderer derives the folder structure from its segments. `change` drives the
 * change badge (A/M/D/R); `note` + `snippet` (with optional `language`) make the
 * file row expandable to show why it changes and a code preview.
 */
export interface FileTreeEntry {
  path: string;
  change?: FileTreeChange;
  note?: string;
  snippet?: string;
  language?: string;
}

export interface FileTreeData {
  /** Optional heading shown above the tree (e.g. "Files touched"). */
  title?: string;
  entries: FileTreeEntry[];
}

const entrySchema = z.object({
  path: z.string().trim().min(1).max(500),
  change: z.enum(["added", "modified", "removed", "renamed"]).optional(),
  note: z.string().trim().max(2_000).optional(),
  snippet: z.string().max(50_000).optional(),
  language: z.string().trim().max(40).optional(),
}) as z.ZodType<FileTreeEntry>;

/**
 * Data-compatible with the inline `file-tree` member of `planBlockSchema`
 * (`plan-content.ts`). `entries` is required (at least one file); `title` is
 * optional so a fresh tree validates from a couple of files.
 */
export const fileTreeSchema = z.object({
  title: z.string().trim().max(180).optional(),
  entries: z.array(entrySchema).min(1).max(200),
}) as unknown as z.ZodType<FileTreeData>;

/**
 * MDX config: `title` is a flat string attribute and the whole `entries` array is
 * serialized as one JSON prop on a self-closing element — the `<FileTree id …
 * title entries={…} />` form. `toAttrs` emits `title` then `entries` in a STABLE
 * order (the shared `prop()` encoder drops `title` when it is undefined).
 *
 * `fromAttrs` tolerates missing/partial attributes for backward-compat: a missing
 * `title` decodes to `undefined` and a missing `entries` decodes to `[]` so a
 * plan written before this block existed still parses.
 */
export const fileTreeMdx: BlockMdxConfig<FileTreeData> = {
  tag: "FileTree",
  toAttrs: (data) => ({
    title: data.title,
    entries: data.entries,
  }),
  fromAttrs: (attrs) => ({
    title: attrs.string("title"),
    entries: attrs.array<FileTreeEntry>("entries") ?? [],
  }),
};
