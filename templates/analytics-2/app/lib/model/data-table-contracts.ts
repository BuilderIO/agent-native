import { z } from "zod";

/**
 * Read a table's provider metadata. The table id is the opaque browser id the
 * dataset loader already returns:
 *
 *   table:<encoded project>:<encoded dataset>:<encoded table>
 *
 * A caller supplies only that id and the connection it came from. There is no
 * SQL, preview, row, credential or provider-config field in this contract.
 */
export const getDataTableDetailsSchema = z
  .object({
    connectionId: z.string().min(1).max(200),
    tableId: z.string().min(1).max(4096),
  })
  .strict();

export type GetDataTableDetailsInput = z.infer<
  typeof getDataTableDetailsSchema
>;

export const dataTableColumnModeSchema = z.enum([
  "NULLABLE",
  "REQUIRED",
  "REPEATED",
]);

export type DataTableColumnMode = z.infer<typeof dataTableColumnModeSchema>;

/**
 * One provider schema field, including its nested record children. `mode`,
 * `description` and `fields` are always present in our output so an absent
 * provider value is an explicit null or empty list rather than an invented
 * default. The provider's own raw field object is never returned.
 */
export type DataTableColumn = {
  name: string;
  type: string;
  mode: DataTableColumnMode | null;
  description: string | null;
  fields: DataTableColumn[];
};

export const dataTableColumnSchema: z.ZodType<DataTableColumn> = z.lazy(() =>
  z
    .object({
      name: z.string().min(1),
      type: z.string().min(1),
      mode: dataTableColumnModeSchema.nullable(),
      description: z.string().nullable(),
      fields: z.array(dataTableColumnSchema),
    })
    .strict(),
);

/**
 * Public table identity and schema. `columnCount` counts only the top-level
 * fields; nested fields stay nested and are never flattened into a fake count.
 * `numRows`, `numBytes` and `lastModifiedTime` are provider strings because
 * BigQuery returns 64-bit integers in string form; a view may legitimately
 * omit them and then they are null, not zero.
 */
export const dataTableMetadataSchema = z
  .object({
    projectId: z.string().min(1),
    datasetId: z.string().min(1),
    tableId: z.string().min(1),
    name: z.string().min(1),
    type: z.string().nullable(),
    description: z.string().nullable(),
    numRows: z.string().nullable(),
    numBytes: z.string().nullable(),
    lastModifiedTime: z.string().nullable(),
    location: z.string().min(1).optional(),
    providerRevision: z.string().min(1).optional(),
    columnCount: z.number().int().nonnegative(),
    columns: z.array(dataTableColumnSchema),
  })
  .strict();

export type DataTableMetadata = z.infer<typeof dataTableMetadataSchema>;

export const dataTableDetailsSchema = z
  .object({
    connectionId: z.string().min(1),
    table: dataTableMetadataSchema,
  })
  .strict();

export type DataTableDetails = z.infer<typeof dataTableDetailsSchema>;
