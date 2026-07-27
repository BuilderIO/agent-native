import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the PLAN-SPECIFIC `data-model` block: its data schema
 * and MDX round-trip config. Shared by the server MDX adapter (`plan-mdx.ts` via
 * `plan-block-registry.ts`) and the client spec (`planBlocks.tsx`). Keeping this
 * React-free means importing it into a server module never pulls React into the
 * Nitro/SSR bundle.
 *
 * The block renders a dbdiagram / Prisma-style entity-relationship diagram: a set
 * of entity cards (each a small table of fields with PK / FK / nullable flags)
 * plus optional explicit relations. The Read renderer makes foreign keys
 * interactive — hovering / clicking an FK highlights and scrolls to the
 * referenced entity — which is why this is a custom block, not a plain table.
 *
 * The schema MUST stay data-compatible with the `data-model` branch of
 * `planBlockSchema` (`plan-content.ts`), and the MDX `tag` (`DataModel`) +
 * attribute shape MUST match the inline planBlockSchema member so stored `.mdx`
 * round-trips: the whole `entities` and `relations` arrays are JSON props
 * (`<DataModel id … entities={…} relations={…} />`).
 */

/** Cardinality of a relation between two entities. */
export type DataModelRelationKind = "1-1" | "1-n" | "n-n";

export const DATA_MODEL_RELATION_KINDS: DataModelRelationKind[] = [
  "1-1",
  "1-n",
  "n-n",
];

/**
 * Diff status of an entity or field, used to render before/after change chips
 * on a data model. Shares the SAME vocabulary as the `file-tree` block's
 * `FileTreeChange` so change chips look consistent across dev-doc blocks.
 */
export type DataModelChange = "added" | "modified" | "removed" | "renamed";

export const DATA_MODEL_CHANGES: DataModelChange[] = [
  "added",
  "modified",
  "removed",
  "renamed",
];

/** One column of an entity. `fk` is a string like `"User.id"`. */
export interface DataModelField {
  name: string;
  type?: string;
  pk?: boolean;
  /** Foreign-key target, e.g. `"User.id"` (entity name/id + optional field). */
  fk?: string;
  nullable?: boolean;
  default?: string;
  note?: string;
  /** Diff status of this field, driving its change chip. */
  change?: DataModelChange;
  /** Prior value when `change === "modified"` (e.g. the old column type). */
  was?: string;
}

/** One table / model. `id` is referenced by relations (`from`/`to`). */
export interface DataModelEntity {
  id: string;
  name: string;
  note?: string;
  /** Diff status of the whole table (added / removed / renamed / modified). */
  change?: DataModelChange;
  fields: DataModelField[];
}

/** An explicit relation between two entities, by `id` (or `name`). */
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

/** Diff-status enum, shared with the inline `data-model` schema's `change`. */
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

/**
 * Data-compatible with the inline `data-model` member of `planBlockSchema`
 * (`plan-content.ts`). At least one entity is required; `relations` is optional
 * (the Read renderer can infer simple `1-n` relations from `fk` fields when it is
 * omitted) so a fresh model validates from a single entity with a couple fields.
 */
export const dataModelSchema = z.object({
  entities: z.array(entitySchema).min(1).max(60),
  relations: z.array(relationSchema).max(200).optional(),
}) as unknown as z.ZodType<DataModelData>;

/**
 * MDX config: the whole `entities` and `relations` arrays are serialized as JSON
 * props on a self-closing element — the `<DataModel id … entities={…}
 * relations={…} />` form. `toAttrs` emits `entities` then `relations` in a STABLE
 * order (the shared `prop()` encoder drops `relations` when it is undefined).
 * Because `entities` is one JSON prop, each entity's `change` and each field's
 * `change` / `was` diff attributes ride along inside it and round-trip verbatim
 * (export → import) with no per-attribute handling, mirroring how `file-tree`
 * encodes its per-entry `change` inside the `entries` JSON prop.
 *
 * `fromAttrs` tolerates missing/partial attributes for backward-compat: a missing
 * `entities` decodes to `[]` and a missing `relations` decodes to `undefined` so
 * a plan written before this block existed still parses.
 */
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
