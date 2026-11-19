import { z } from "zod";

export const TABLE_COLLECTION_MAX_ROWS = 500;
export const TABLE_COLLECTION_MAX_COLUMNS = 50;
export const TABLE_COLLECTION_MAX_CELL_LENGTH = 20_000;
export const TABLE_COLLECTION_MAX_TITLE_LENGTH = 500;
export const TABLE_COLLECTION_MAX_NAME_LENGTH = 200;

export interface TableCollectionSeed {
  properties: string[];
  rows: string[][];
}

export const tableCollectionSeedSchema = z
  .object({
    properties: z
      .array(z.string().trim().min(1).max(TABLE_COLLECTION_MAX_NAME_LENGTH))
      .max(TABLE_COLLECTION_MAX_COLUMNS - 1),
    rows: z
      .array(z.array(z.string().max(TABLE_COLLECTION_MAX_CELL_LENGTH)))
      .max(TABLE_COLLECTION_MAX_ROWS),
  })
  .superRefine((seed, ctx) => {
    seed.rows.forEach((cells, index) => {
      if (cells.length !== seed.properties.length + 1) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", index],
          message: "Each row needs a title and one cell for every property.",
        });
      } else if ((cells[0] ?? "").length > TABLE_COLLECTION_MAX_TITLE_LENGTH) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", index, 0],
          message: `A row title can be at most ${TABLE_COLLECTION_MAX_TITLE_LENGTH} characters.`,
        });
      }
    });
  }) as unknown as z.ZodType<TableCollectionSeed>;
