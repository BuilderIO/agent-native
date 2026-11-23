import { z } from "zod";

/**
 * Annotations a person can attach to a warehouse resource in the Data browser.
 *
 * A resource is the connection itself or a database / schema / table node below
 * it. The shapes here are the only fields this app accepts or returns: there is
 * deliberately no place for a connection config, a credential reference or an
 * owner string, so a request cannot smuggle one and a response cannot leak one.
 */
export const DATA_RESOURCE_KINDS = [
  "connection",
  "database",
  "schema",
  "table",
] as const;

export type DataResourceKind = (typeof DATA_RESOURCE_KINDS)[number];

export const dataResourceKindSchema = z.enum(DATA_RESOURCE_KINDS);

export const dataResourceRefSchema = z
  .object({
    kind: dataResourceKindSchema,
    id: z.string().min(1).max(1000),
  })
  .strict();

export type DataResourceRef = z.infer<typeof dataResourceRefSchema>;

/**
 * AI usage is a two-value choice; a resource with no choice of its own inherits
 * its parent's value. `null` says "no override" and the server never invents an
 * effective value from it.
 */
export const dataResourceAiUsageSchema = z.enum(["included", "excluded"]);

export type DataResourceAiUsage = z.infer<typeof dataResourceAiUsageSchema>;

export const dataResourceMetadataSchema = z.object({
  connectionId: z.string(),
  kind: dataResourceKindSchema,
  id: z.string(),
  description: z.string(),
  statusId: z.string().nullable(),
  categoryIds: z.array(z.string()),
  aiUsage: dataResourceAiUsageSchema.nullable(),
});

export type DataResourceMetadata = z.infer<typeof dataResourceMetadataSchema>;

export const dataResourceMetadataListSchema = z.object({
  connectionId: z.string(),
  resources: z.array(dataResourceMetadataSchema),
});

export type DataResourceMetadataList = z.infer<
  typeof dataResourceMetadataListSchema
>;

export const listDataResourceMetadataSchema = z
  .object({
    connectionId: z.string().min(1).max(200),
    /**
     * Optional pinning of the resources the caller wants. Without it the
     * action remains a prefix read of every saved annotation for the one
     * connection: the browser decides how many resources to ask about, the
     * server does not truncate the answer.
     */
    resources: z.array(dataResourceRefSchema).optional(),
  })
  .strict();

export type ListDataResourceMetadataInput = z.infer<
  typeof listDataResourceMetadataSchema
>;

/**
 * One add/remove operation is applied inside the store's compare-and-set loop
 * against the freshest list, so two people toggling different categories both
 * keep their change. The whole-array `categoryIds` form remains available as an
 * explicit replacement, but a single patch may not carry both forms.
 */
export const dataCategoryChangeSchema = z
  .object({
    categoryId: z.string().min(1).max(200),
    added: z.boolean(),
  })
  .strict();

export type DataCategoryChange = z.infer<typeof dataCategoryChangeSchema>;

/**
 * A patch carries only annotation fields. `.strict()` is the guard that rejects
 * an unknown field (a credential, a config blob) instead of persisting it.
 */
export const dataResourceMetadataPatchSchema = z
  .object({
    description: z.string().max(4000).optional(),
    statusId: z.string().min(1).max(200).nullable().optional(),
    /** Explicit replacement of the whole category list. */
    categoryIds: z.array(z.string().min(1).max(200)).optional(),
    /** Atomic single-category add/remove. */
    categoryChange: dataCategoryChangeSchema.optional(),
    aiUsage: dataResourceAiUsageSchema.nullable().optional(),
  })
  .strict()
  .superRefine((patch, context) => {
    if (patch.categoryIds !== undefined && patch.categoryChange !== undefined) {
      context.addIssue({
        code: "custom",
        message:
          "Send either categoryIds or categoryChange, not both in one patch.",
      });
    }
  });

export type DataResourceMetadataPatch = z.infer<
  typeof dataResourceMetadataPatchSchema
>;

export const updateDataResourceMetadataSchema = z
  .object({
    connectionId: z.string().min(1).max(200),
    resource: dataResourceRefSchema,
    patch: dataResourceMetadataPatchSchema,
  })
  .strict();

export type UpdateDataResourceMetadataInput = z.infer<
  typeof updateDataResourceMetadataSchema
>;

/**
 * Categories are an organisation-wide catalogue applied to any resource. The
 * catalogue is bounded and every stored colour comes from this contract.
 */
export const DATA_CATEGORY_CATALOGUE_LIMIT = 100;

/** Colours are a six-digit hex string; anything else is not catalogue data. */
export const dataCategoryColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/);

export const dataCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  description: z.string().default(""),
});

export type DataCategory = z.infer<typeof dataCategorySchema>;

export const dataCategoryListSchema = z.object({
  categories: z.array(dataCategorySchema),
});

export type DataCategoryList = z.infer<typeof dataCategoryListSchema>;

export const createDataCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    color: dataCategoryColorSchema,
    description: z.string().max(200).optional(),
  })
  .strict();

export type CreateDataCategoryInput = z.infer<typeof createDataCategorySchema>;

export const createDataCategoryResultSchema = z.object({
  category: dataCategorySchema,
});

export const deleteDataCategorySchema = z
  .object({
    id: z.string().trim().min(1),
  })
  .strict();

export type DeleteDataCategoryInput = z.infer<typeof deleteDataCategorySchema>;

export const deleteDataCategoryResultSchema = z.object({
  removedId: z.string(),
});
