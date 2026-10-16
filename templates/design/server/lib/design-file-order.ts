import { asc, sql } from "drizzle-orm";

import type * as designSchema from "../db/schema.js";

type DesignFileOrderSchema = Pick<
  typeof designSchema,
  "designFiles" | "designScreenRestoreClaims"
>;

export function designFileOrder(schema: DesignFileOrderSchema) {
  return [
    asc(schema.designFiles.createdAt),
    asc(
      sql`coalesce(${schema.designScreenRestoreClaims.snapshot}::jsonb ->> 'fileOrderKey', ${schema.designScreenRestoreClaims.sourceFileId}, ${schema.designFiles.id})`,
    ),
  ] as const;
}
