import { z } from "zod";

export const DATA_BROWSER_STATE_KEY = "data-browser";

export const dataBrowserTabSchema = z.enum([
  "recommended",
  "warehouse",
  "models",
  "curation",
]);

export const dataBrowserSelectionSchema = z
  .object({
    kind: z.enum(["connection", "model", "dataset"]),
    id: z.string().min(1),
  })
  .nullable();

export const dataBrowserBrowsePathSchema = z
  .object({
    datasetId: z.string().min(1),
    tableReference: z.string().min(1).optional(),
    columnName: z.string().min(1).optional(),
  })
  .nullable();

export const dataBrowserStateSchema = z.object({
  tab: dataBrowserTabSchema,
  selection: dataBrowserSelectionSchema,
  listCollapsed: z.boolean(),
  // Drill-down position inside the selected warehouse connection.
  browse: dataBrowserBrowsePathSchema.optional(),
});

export type DataBrowserTab = z.infer<typeof dataBrowserTabSchema>;
export type DataBrowserSelection = z.infer<typeof dataBrowserSelectionSchema>;
export type DataBrowserBrowsePath = z.infer<typeof dataBrowserBrowsePathSchema>;
export type DataBrowserState = z.infer<typeof dataBrowserStateSchema>;

export const DEFAULT_DATA_BROWSER_STATE: DataBrowserState = {
  tab: "warehouse",
  selection: null,
  listCollapsed: false,
};

export function parseDataBrowserState(value: unknown): DataBrowserState {
  if (value === null) return DEFAULT_DATA_BROWSER_STATE;
  return dataBrowserStateSchema.parse(value);
}
