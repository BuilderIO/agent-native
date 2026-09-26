import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

export type FileTreeChange = "added" | "modified" | "removed" | "renamed";

export const FILE_TREE_CHANGES: FileTreeChange[] = [
  "added",
  "modified",
  "removed",
  "renamed",
];

export interface FileTreeEntry {
  path: string;
  change?: FileTreeChange;
  note?: string;
  snippet?: string;
  language?: string;
}

export interface FileTreeData {
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

export const fileTreeSchema = z.object({
  title: z.string().trim().max(180).optional(),
  entries: z.array(entrySchema).min(1).max(200),
}) as unknown as z.ZodType<FileTreeData>;

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
