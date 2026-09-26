import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";


export type DataModelRelationKind = "1-1" | "1-n" | "n-n";

export const DATA_MODEL_RELATION_KINDS: DataModelRelationKind[] = [
  "1-1",
  "1-n",
  "n-n",
];

export type DataModelChange = "added" | "modified" | "removed" | "renamed";

export const DATA_MODEL_CHANGES: DataModelChange[] = [
  "added",
  "modified",
  "removed",
  "renamed",
];

export interface DataModelField {
  name: string;
  type?: string;
  pk?: boolean;
  fk?: string;
  nullable?: boolean;
  default?: string;
  note?: string;
  change?: DataModelChange;
  was?: string;
}

export interface DataModelEntity {
  id: string;
  name: string;
  note?: string;
  change?: DataModelChange;
  fields: DataModelField[];
}

export interface DataModelRelation {
  from: string;
  to: string;
  kind?: DataModelRelationKind;
  label?: string;
}

export interface DataModelData {
  entities: DataModelEntity[];
  relations?: DataModelRelation[];
}

const changeSchema = z.enum(["added", "modified", "removed", "renamed"]);

const fieldSchema = z.object({
  name: z.string().trim().min(1).max(160),
  type: z.string().trim().max(120).optional(),
  pk: z.boolean().optional(),
  fk: z.string().trim().max(200).optional(),
  nullable: z.boolean().optional(),
  default: z.string().trim().max(400).optional(),
  note: z.string().trim().max(600).optional(),
  change: changeSchema.optional(),
  was: z.string().trim().max(400).optional(),
}) as z.ZodType<DataModelField>;

const entitySchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  note: z.string().trim().max(600).optional(),
  change: changeSchema.optional(),
  fields: z.array(fieldSchema).max(80),
}) as z.ZodType<DataModelEntity>;

const relationSchema = z.object({
  from: z.string().trim().min(1).max(120),
  to: z.string().trim().min(1).max(120),
  kind: z.enum(["1-1", "1-n", "n-n"]).optional(),
  label: z.string().trim().max(160).optional(),
}) as z.ZodType<DataModelRelation>;

export const dataModelSchema = z.object({
  entities: z.array(entitySchema).min(1).max(60),
  relations: z.array(relationSchema).max(200).optional(),
}) as unknown as z.ZodType<DataModelData>;

export const dataModelMdx: BlockMdxConfig<DataModelData> = {
  tag: "DataModel",
  toAttrs: (data) => ({
    entities: data.entities,
    relations: data.relations,
  }),
  fromAttrs: (attrs) => ({
    entities: attrs.array<DataModelEntity>("entities") ?? [],
    relations: attrs.array<DataModelRelation>("relations"),
  }),
};
