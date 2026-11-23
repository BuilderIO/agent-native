import { z } from "zod";

const id = z.string().min(1).max(1024);
const revision = z.string().regex(/^(0|[1-9][0-9]*)$/);

export const warehouseTableRefSchema = z.strictObject({
  connectionId: id,
  tableId: id,
  catalogGeneration: revision,
  authorityGeneration: revision,
});

export const warehouseTableProvenanceSchema = warehouseTableRefSchema.extend({
  projectId: id,
  schema: id,
  name: id,
  location: id.nullable(),
});

export type WarehouseTableRef = z.infer<typeof warehouseTableRefSchema>;
export type WarehouseTableProvenance = z.infer<
  typeof warehouseTableProvenanceSchema
>;
