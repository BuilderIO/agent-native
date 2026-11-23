import { z } from "zod";

/**
 * The list inputs a saved view restores. Values mirror the workspace list's own
 * state so applying a view is a plain state restore.
 *
 * A filter value is a string, or a list of strings where the list's control
 * accepts more than one choice (the creator filter stores every selected
 * creator), and the older single-value form keeps parsing.
 */
export const savedViewFilterValueSchema = z.union([
  z.string().max(200),
  z.array(z.string().max(200)).max(50),
]);

export const savedViewStateSchema = z
  .object({
    titleFilter: z.string().max(200).default(""),
    filters: z
      .record(z.string().max(80), savedViewFilterValueSchema)
      .default({}),
    sort: z.string().max(80).default(""),
    sortDirection: z.enum(["asc", "desc"]).default("desc"),
    view: z.enum(["list", "grid"]).default("list"),
    tab: z.string().max(80).nullable().default(null),
    hiddenColumns: z.array(z.string().max(80)).max(60).default([]),
    viewsDuration: z.string().max(40).default("allTime"),
  })
  .strict();

export type SavedViewState = z.infer<typeof savedViewStateSchema>;

export const savedViewNameSchema = z.string().trim().min(1).max(80);

export interface SavedViewSummary {
  id: string;
  name: string;
  state: SavedViewState;
  updatedAt: string | null;
}
