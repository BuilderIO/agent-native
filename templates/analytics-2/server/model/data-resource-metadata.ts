import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import {
  deleteSetting,
  deleteSettingIfValue,
  getSettingEntry,
  listOrgSettings,
  mutateOrgSetting,
  type StoreMutationOptions,
} from "@agent-native/core/settings";
import { z } from "zod";

import {
  DATA_CATEGORY_CATALOGUE_LIMIT,
  DATA_RESOURCE_KINDS,
  type CreateDataCategoryInput,
  type DataCategory,
  type DataCategoryList,
  type DataResourceKind,
  type DataResourceMetadata,
  type DataResourceMetadataList,
  type DataResourceMetadataPatch,
  type DataResourceRef,
  dataCategoryListSchema,
  dataResourceMetadataListSchema,
} from "../../app/lib/model/data-resource-contracts.js";
import { noteOrgDataChange } from "./data-change-events.js";
import type { WorkspaceScope } from "./scope.js";
import { listStatuses } from "./statuses-store.js";

/**
 * Warehouse annotations are local metadata kept in the organisation's scoped
 * settings. They never write to a provider database, and no credential or
 * connection config is read or stored here.
 *
 * Keyspace (the organisation prefix is added by the settings helpers):
 *   analytics.data.resource-metadata:v1:<connection>:<kind>:<resource>
 *   analytics.data.categories:v1
 *
 * Each part is percent-encoded, so a separator can only appear where this
 * module put it and two different resources can never share a key.
 */
const METADATA_NAMESPACE = "analytics.data.resource-metadata:v1";
const CATEGORY_KEY = "analytics.data.categories:v1";
const DELETION_KEY_PREFIX = "analytics.data.connection-deletion:v1";

/** Read/write seam that lets a caller join the app's short DB transaction. */
export type MetadataStoreOptions = StoreMutationOptions & {
  bypassCache?: boolean;
};

const storedMetadataSchema = z
  .object({
    description: z.string(),
    statusId: z.string().nullable(),
    categoryIds: z.array(z.string()),
    aiUsage: z.enum(["included", "excluded"]).nullable(),
    // Presence markers separate "never edited" from an intentional clear.
    // Rows written before the marker existed read as uninitialized, which keeps
    // the legacy connection config as the fallback instead of inventing a clear.
    descriptionInitialized: z.boolean().optional(),
    aiUsageInitialized: z.boolean().optional(),
    revision: z.number().int().nonnegative().optional(),
  })
  .strict();

const storedCategorySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string().nullable(),
    description: z.string().default(""),
  })
  .strict();

const storedCatalogueSchema = z
  .object({ categories: z.array(storedCategorySchema) })
  .strict();

export type StoredMetadata = z.infer<typeof storedMetadataSchema>;

/** A duplicate category name is a recoverable answer, not a crash. */
export class DataCategoryNameConflictError extends Error {
  readonly code = "data_category_name_conflict";
  readonly errorCode = "data_category_name_conflict";
  readonly statusCode = 409;

  constructor(name: string) {
    super(`A category named "${name}" already exists in this workspace.`);
    this.name = "DataCategoryNameConflictError";
  }
}

/** The catalogue is bounded before the next entry is considered. */
export class DataCategoryLimitError extends Error {
  readonly code = "data_category_limit_reached";
  readonly errorCode = "data_category_limit_reached";
  readonly statusCode = 400;

  constructor() {
    super(
      `This workspace already has ${DATA_CATEGORY_CATALOGUE_LIMIT} categories.`,
    );
    this.name = "DataCategoryLimitError";
  }
}

function corrupted(what: string): never {
  return fail(
    `The saved ${what} could not be read. No annotation was changed.`,
    { statusCode: 500, errorCode: "data_resource_metadata_corrupt" },
  );
}

/** The organisation key the settings store uses; entries are read by exact key. */
function orgSettingKey(orgId: string, key: string): string {
  return `o:${orgId}:${key}`;
}

function metadataPrefix(connectionId: string): string {
  return `${METADATA_NAMESPACE}:${encodeURIComponent(connectionId)}:`;
}

function metadataKey(connectionId: string, ref: DataResourceRef): string {
  return `${metadataPrefix(connectionId)}${ref.kind}:${encodeURIComponent(ref.id)}`;
}

function emptyMetadata(
  connectionId: string,
  ref: DataResourceRef,
): DataResourceMetadata {
  return {
    connectionId,
    kind: ref.kind,
    id: ref.id,
    description: "",
    statusId: null,
    categoryIds: [],
    aiUsage: null,
  };
}

function toMetadata(
  connectionId: string,
  kind: DataResourceKind,
  id: string,
  stored: StoredMetadata,
): DataResourceMetadata {
  return {
    connectionId,
    kind,
    id,
    description: stored.description,
    statusId: stored.statusId,
    categoryIds: [...stored.categoryIds],
    aiUsage: stored.aiUsage,
  };
}

function parseStoredMetadata(raw: unknown): StoredMetadata {
  const parsed = storedMetadataSchema.safeParse(raw);
  if (!parsed.success) corrupted("data annotations");
  return parsed.data as StoredMetadata;
}

/**
 * Reads one annotation by its exact key. A missing entry is `null`; a present
 * entry with the wrong shape (including a stored JSON null, a scalar or an
 * array) is a typed failure, never an empty annotation.
 */
async function readMetadataEntry(
  scope: WorkspaceScope,
  key: string,
  options?: MetadataStoreOptions,
): Promise<StoredMetadata | null> {
  let entry;
  try {
    entry = await getSettingEntry(orgSettingKey(scope.orgId, key), options);
  } catch (error) {
    if (error instanceof SyntaxError) corrupted("data annotations");
    throw error;
  }
  if (!entry.found) return null;
  return parseStoredMetadata(entry.value);
}

/**
 * Rejects a present entry whose stored shape is not an annotation before the
 * compare-and-set updater runs, including a stored JSON null that would
 * otherwise look like an absent row.
 */
const metadataMutationOptions: StoreMutationOptions = {
  validateStoredValue: (value) => {
    parseStoredMetadata(value);
  },
};

function parseCatalogue(raw: unknown): DataCategory[] {
  const parsed = storedCatalogueSchema.safeParse(raw);
  if (!parsed.success) corrupted("data categories");
  return parsed.data.categories;
}

async function readCatalogueEntry(
  scope: WorkspaceScope,
  options?: MetadataStoreOptions,
): Promise<DataCategory[] | null> {
  let entry;
  try {
    entry = await getSettingEntry(
      orgSettingKey(scope.orgId, CATEGORY_KEY),
      options,
    );
  } catch (error) {
    if (error instanceof SyntaxError) corrupted("data categories");
    throw error;
  }
  if (!entry.found) return null;
  return parseCatalogue(entry.value);
}

const categoryMutationOptions: StoreMutationOptions = {
  validateStoredValue: (value) => {
    parseCatalogue(value);
  },
};

/**
 * Reads every saved annotation for one connection in a single prefix query.
 * The result is keyed by the resource part of the setting key.
 */
async function readStoredForConnection(
  scope: WorkspaceScope,
  connectionId: string,
): Promise<Map<string, StoredMetadata>> {
  const prefix = metadataPrefix(connectionId);
  let settings: Record<string, Record<string, unknown>>;
  try {
    settings = await listOrgSettings(scope.orgId, prefix);
  } catch (error) {
    if (error instanceof SyntaxError) corrupted("data annotations");
    throw error;
  }
  const byResource = new Map<string, StoredMetadata>();
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith(prefix)) continue;
    const resourceKey = key.slice(prefix.length);
    const separator = resourceKey.indexOf(":");
    if (separator < 1) continue;
    const kind = resourceKey.slice(0, separator);
    const encodedId = resourceKey.slice(separator + 1);
    if (!DATA_RESOURCE_KINDS.includes(kind as DataResourceKind)) continue;
    let id: string;
    try {
      id = decodeURIComponent(encodedId);
    } catch {
      continue;
    }
    byResource.set(`${kind}:${id}`, parseStoredMetadata(value));
  }
  return byResource;
}

function compareResources(
  a: { kind: DataResourceKind; id: string },
  b: { kind: DataResourceKind; id: string },
): number {
  const rank =
    DATA_RESOURCE_KINDS.indexOf(a.kind) - DATA_RESOURCE_KINDS.indexOf(b.kind);
  if (rank !== 0) return rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Reads the annotations of one already-authorised connection.
 *
 * With `resources` only the exact requested keys are read (an unrelated
 * corrupt entry elsewhere under the connection cannot hide a healthy one) and a
 * never-annotated resource gets the real empty annotation. Without `resources`
 * this is a full prefix read of everything saved for that connection, with no
 * output cap.
 */
export async function readDataResourceMetadata(
  scope: WorkspaceScope,
  connectionId: string,
  resources?: readonly DataResourceRef[],
  options: MetadataStoreOptions = {},
): Promise<DataResourceMetadataList> {
  if (resources === undefined) {
    const stored = await readStoredForConnection(scope, connectionId);
    const entries = [...stored.entries()].map(([resourceKey, value]) => {
      const separator = resourceKey.indexOf(":");
      const kind = resourceKey.slice(0, separator) as DataResourceKind;
      const id = resourceKey.slice(separator + 1);
      return toMetadata(connectionId, kind, id, value);
    });
    entries.sort(compareResources);
    return dataResourceMetadataListSchema.parse({
      connectionId,
      resources: entries,
    });
  }

  const seen = new Set<string>();
  const entries: DataResourceMetadata[] = [];
  for (const ref of resources) {
    assertResourceBelongsToConnection(connectionId, ref);
    const resourceKey = `${ref.kind}:${ref.id}`;
    if (seen.has(resourceKey)) continue;
    seen.add(resourceKey);
    const value = await readMetadataEntry(
      scope,
      metadataKey(connectionId, ref),
      options,
    );
    entries.push(
      value === null
        ? emptyMetadata(connectionId, ref)
        : toMetadata(connectionId, ref.kind, ref.id, value),
    );
  }
  return dataResourceMetadataListSchema.parse({
    connectionId,
    resources: entries,
  });
}

/**
 * A connection annotation is about the connection itself, so its resource id
 * must be that connection. Reads and writes share the invariant, so a caller
 * can never store or read an annotation under a resource that does not belong
 * to the key.
 */
export function assertResourceBelongsToConnection(
  connectionId: string,
  ref: DataResourceRef,
): void {
  if (ref.kind === "connection" && ref.id !== connectionId) {
    fail("That annotation does not belong to this data connection.", {
      statusCode: 400,
      errorCode: "data_resource_ref_mismatch",
    });
  }
}

async function assertStatusInWorkspace(
  scope: WorkspaceScope,
  statusId: string,
): Promise<void> {
  const statuses = await listStatuses(scope);
  if (!statuses.some((status) => status.id === statusId)) {
    fail("That status is not in this workspace.", {
      statusCode: 400,
      errorCode: "data_resource_status_not_found",
    });
  }
}

async function assertCategoriesInWorkspace(
  scope: WorkspaceScope,
  categoryIds: readonly string[],
): Promise<void> {
  if (categoryIds.length === 0) return;
  const categories = (await readCatalogueEntry(scope)) ?? [];
  const known = new Set(categories.map((category) => category.id));
  if (categoryIds.some((id) => !known.has(id))) {
    fail("That category is not in this workspace.", {
      statusCode: 400,
      errorCode: "data_resource_category_not_found",
    });
  }
}

/**
 * Applies only the fields named in the patch.
 *
 * The merge runs inside the settings store's compare-and-set retry, so the
 * updater sees the freshest value after a lost race. A `categoryChange` is
 * applied to that fresh list, which keeps two concurrent toggles of different
 * categories; `categoryIds` is the separate explicit replacement form.
 */
export async function writeDataResourceMetadata(
  scope: WorkspaceScope,
  connectionId: string,
  ref: DataResourceRef,
  patch: DataResourceMetadataPatch,
  options: MetadataStoreOptions = {},
): Promise<DataResourceMetadata> {
  if (Object.keys(patch).length === 0) {
    fail("Add at least one annotation field to update.", {
      statusCode: 400,
      errorCode: "data_resource_patch_empty",
    });
  }
  assertResourceBelongsToConnection(connectionId, ref);
  if (patch.statusId !== undefined && patch.statusId !== null) {
    await assertStatusInWorkspace(scope, patch.statusId);
  }
  if (patch.categoryIds !== undefined) {
    await assertCategoriesInWorkspace(scope, patch.categoryIds);
  }
  if (patch.categoryChange !== undefined) {
    await assertCategoriesInWorkspace(scope, [patch.categoryChange.categoryId]);
  }
  // Rechecked inside the write path so a writer that raced a deletion cannot
  // land an annotation after the terminal tombstone.
  await assertConnectionWritable(scope, connectionId, options);

  const key = metadataKey(connectionId, ref);
  let next: Record<string, unknown>;
  try {
    next = await mutateOrgSetting(
      scope.orgId,
      key,
      (current) => {
        const existing: StoredMetadata =
          current === null
            ? {
                description: "",
                statusId: null,
                categoryIds: [],
                aiUsage: null,
              }
            : parseStoredMetadata(current);
        const merged: StoredMetadata = {
          ...existing,
          descriptionInitialized: existing.descriptionInitialized === true,
          aiUsageInitialized: existing.aiUsageInitialized === true,
        };
        if (patch.description !== undefined) {
          merged.description = patch.description;
          merged.descriptionInitialized = true;
        }
        if (patch.statusId !== undefined) merged.statusId = patch.statusId;
        if (patch.categoryIds !== undefined) {
          merged.categoryIds = [...new Set(patch.categoryIds)];
        }
        if (patch.categoryChange !== undefined) {
          const categories = new Set(merged.categoryIds);
          if (patch.categoryChange.added) {
            categories.add(patch.categoryChange.categoryId);
          } else {
            categories.delete(patch.categoryChange.categoryId);
          }
          merged.categoryIds = [...categories];
        }
        if (patch.aiUsage !== undefined) {
          merged.aiUsage = patch.aiUsage;
          merged.aiUsageInitialized = true;
        }
        merged.revision = (existing.revision ?? 0) + 1;
        return merged;
      },
      { ...options, ...metadataMutationOptions },
    );
  } catch (error) {
    if (error instanceof SyntaxError) corrupted("data annotations");
    throw error;
  }

  if (options.transaction) noteOrgDataChange(scope.orgId, key);
  if (ref.kind === "connection" && patch.aiUsage !== undefined) {
    await resetDescendantAiUsage(scope, connectionId, options);
  }
  if (patch.aiUsage !== undefined) {
    const policyMutationOptions: StoreMutationOptions = {
      ...options,
      validateStoredValue: (value: unknown) => {
        if (!resourcePolicyRevisionSchema.safeParse(value).success)
          fail("The data resource policy could not be read.", {
            statusCode: 500,
            errorCode: "data_resource_policy_corrupt",
          });
      },
    };
    await mutateOrgSetting(
      scope.orgId,
      resourcePolicyRevisionKey(connectionId),
      (current) => ({
        revision:
          typeof current?.revision === "number" &&
          Number.isSafeInteger(current.revision)
            ? current.revision + 1
            : 1,
      }),
      policyMutationOptions,
    );
  }
  if (patch.aiUsage !== undefined && options.transaction)
    noteOrgDataChange(scope.orgId, resourcePolicyRevisionKey(connectionId));
  return toMetadata(connectionId, ref.kind, ref.id, parseStoredMetadata(next));
}

/**
 * A connection-level include/exclude is the ancestor policy for every resource
 * below it, so explicit child overrides are cleared in the same store options
 * (a caller inside the app transaction makes the whole reset atomic).
 */
export async function resetDescendantAiUsage(
  scope: WorkspaceScope,
  connectionId: string,
  options: MetadataStoreOptions = {},
): Promise<{ cleared: number }> {
  const prefix = metadataPrefix(connectionId);
  let settings: Record<string, Record<string, unknown>>;
  try {
    settings = await listOrgSettings(scope.orgId, prefix);
  } catch (error) {
    if (error instanceof SyntaxError) corrupted("data annotations");
    throw error;
  }
  let cleared = 0;
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith(prefix)) continue;
    const resourceKey = key.slice(prefix.length);
    const separator = resourceKey.indexOf(":");
    if (separator < 1) continue;
    const kind = resourceKey.slice(0, separator);
    if (
      kind === "connection" ||
      !DATA_RESOURCE_KINDS.includes(kind as DataResourceKind)
    )
      continue;
    const stored = parseStoredMetadata(value);
    if (stored.aiUsageInitialized !== true && stored.aiUsage === null) continue;
    await mutateOrgSetting(
      scope.orgId,
      key,
      (current) => {
        const existing = parseStoredMetadata(current);
        return {
          ...existing,
          aiUsage: null,
          aiUsageInitialized: false,
          revision: (existing.revision ?? 0) + 1,
        };
      },
      { ...options, ...metadataMutationOptions },
    );
    if (options.transaction) noteOrgDataChange(scope.orgId, key);
    cleared += 1;
  }
  return { cleared };
}

/** Reads the raw canonical override, including presence markers and revision. */
export async function readConnectionAnnotationOverride(
  scope: WorkspaceScope,
  connectionId: string,
  options: MetadataStoreOptions = {},
): Promise<StoredMetadata | null> {
  return readMetadataEntry(
    scope,
    metadataKey(connectionId, { kind: "connection", id: connectionId }),
    options,
  );
}

export async function readConnectionAnnotationOverrides(
  scope: WorkspaceScope,
  connectionIds: readonly string[],
  options: MetadataStoreOptions = {},
): Promise<Map<string, StoredMetadata | null>> {
  const overrides = new Map<string, StoredMetadata | null>();
  if (connectionIds.length === 0) return overrides;
  if (connectionIds.length === 1) {
    const id = connectionIds[0]!;
    overrides.set(
      id,
      await readConnectionAnnotationOverride(scope, id, options),
    );
    return overrides;
  }
  let settings: Record<string, Record<string, unknown>>;
  try {
    settings = await listOrgSettings(scope.orgId, `${METADATA_NAMESPACE}:`);
  } catch (error) {
    if (error instanceof SyntaxError) corrupted("data annotations");
    throw error;
  }
  for (const id of connectionIds) {
    const key = metadataKey(id, { kind: "connection", id });
    const raw = settings[key];
    overrides.set(id, raw === undefined ? null : parseStoredMetadata(raw));
  }
  return overrides;
}

/** The organisation-wide category catalogue, in the order it was created. */
export async function readDataCategories(
  scope: WorkspaceScope,
): Promise<DataCategoryList> {
  const categories = (await readCatalogueEntry(scope)) ?? [];
  return dataCategoryListSchema.parse({ categories });
}

function newCategoryId(): string {
  return `cat_${randomUUID().replaceAll("-", "")}`;
}

/**
 * Creates one catalogue entry. The name and size checks run inside the
 * mutation, so a concurrent second create of the same name (or a create that
 * would exceed the catalogue limit) can never add an entry.
 */
export async function createDataCategory(
  scope: WorkspaceScope,
  input: CreateDataCategoryInput,
): Promise<DataCategory> {
  const name = input.name.trim();
  if (name === "") {
    fail("A category needs a name.", {
      statusCode: 400,
      errorCode: "data_category_name_required",
    });
  }
  const id = newCategoryId();
  let next: Record<string, unknown>;
  try {
    next = await mutateOrgSetting(
      scope.orgId,
      CATEGORY_KEY,
      (current) => {
        const categories = current === null ? [] : parseCatalogue(current);
        if (categories.length >= DATA_CATEGORY_CATALOGUE_LIMIT) {
          throw new DataCategoryLimitError();
        }
        if (categories.some((category) => category.name === name)) {
          throw new DataCategoryNameConflictError(name);
        }
        return {
          categories: [
            ...categories,
            {
              id,
              name,
              color: input.color,
              description: input.description ?? "",
            },
          ],
        };
      },
      categoryMutationOptions,
    );
  } catch (error) {
    if (error instanceof SyntaxError) corrupted("data categories");
    throw error;
  }
  const category = parseCatalogue(next).find((entry) => entry.id === id);
  if (category === undefined) corrupted("data categories");
  return category;
}

/** Update a category atomically in the current organisation's catalogue. */
export async function updateDataCategory(
  scope: WorkspaceScope,
  id: string,
  input: CreateDataCategoryInput,
): Promise<DataCategory> {
  const name = input.name.trim();
  if (!name) {
    fail("A category needs a name.", {
      statusCode: 400,
      errorCode: "data_category_name_required",
    });
  }
  let next: Record<string, unknown>;
  try {
    next = await mutateOrgSetting(
      scope.orgId,
      CATEGORY_KEY,
      (current) => {
        const categories = current === null ? [] : parseCatalogue(current);
        if (!categories.some((category) => category.id === id)) {
          fail("That category is no longer in this workspace.", {
            statusCode: 404,
            errorCode: "data_category_not_found",
          });
        }
        if (
          categories.some(
            (category) => category.id !== id && category.name === name,
          )
        ) {
          throw new DataCategoryNameConflictError(name);
        }
        return {
          categories: categories.map((category) =>
            category.id === id
              ? {
                  ...category,
                  name,
                  color: input.color,
                  description: input.description ?? category.description,
                }
              : category,
          ),
        };
      },
      categoryMutationOptions,
    );
  } catch (error) {
    if (error instanceof SyntaxError) corrupted("data categories");
    throw error;
  }
  const category = parseCatalogue(next).find((entry) => entry.id === id);
  if (category === undefined) corrupted("data categories");
  return category;
}

/**
 * Removes one catalogue entry. The existence check runs inside the mutation so
 * two concurrent removes cannot both report success, and an unknown id is the
 * same typed 404 the create path gives a duplicate.
 */
export async function deleteDataCategory(
  scope: WorkspaceScope,
  id: string,
): Promise<{ removedId: string }> {
  let next: Record<string, unknown>;
  try {
    next = await mutateOrgSetting(
      scope.orgId,
      CATEGORY_KEY,
      (current) => {
        const categories = current === null ? [] : parseCatalogue(current);
        if (!categories.some((category) => category.id === id)) {
          fail("That category is no longer in this workspace.", {
            statusCode: 404,
            errorCode: "data_category_not_found",
          });
        }
        return { categories: categories.filter((entry) => entry.id !== id) };
      },
      categoryMutationOptions,
    );
  } catch (error) {
    if (error instanceof SyntaxError) corrupted("data categories");
    throw error;
  }
  if (parseCatalogue(next).some((entry) => entry.id === id)) {
    corrupted("data categories");
  }
  return { removedId: id };
}

/**
 * The annotation-backed connection description for the parent's connection
 * DTO and edit form. `null` means this connection has no saved description;
 * it never reads the provider config or a credential.
 */
export async function readConnectionDescription(
  scope: WorkspaceScope,
  connectionId: string,
): Promise<string | null> {
  const entry = await readMetadataEntry(
    scope,
    metadataKey(connectionId, { kind: "connection", id: connectionId }),
  );
  return entry?.descriptionInitialized === true ? entry.description : null;
}

/**
 * Removes only the annotations whose key carries this exact connection. The
 * delete action calls it when a connection is removed; other connections and
 * the category catalogue are untouched.
 *
 * This is a prefix cleanup, not a transaction: a write that starts after the
 * listing can still land. A tombstone or lock shared with the delete path is
 * required before that race can be called closed.
 */
export async function deleteConnectionAnnotationSettings(
  scope: WorkspaceScope,
  connectionId: string,
  options: MetadataStoreOptions = {},
): Promise<{ deleted: number }> {
  const prefix = metadataPrefix(connectionId);
  let settings: Record<string, Record<string, unknown>>;
  try {
    settings = await listOrgSettings(scope.orgId, prefix);
  } catch (error) {
    if (error instanceof SyntaxError) corrupted("data annotations");
    throw error;
  }
  let deleted = 0;
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith(prefix)) continue;
    const resourceKey = key.slice(prefix.length);
    const separator = resourceKey.indexOf(":");
    if (separator < 1) continue;
    if (
      !DATA_RESOURCE_KINDS.includes(
        resourceKey.slice(0, separator) as DataResourceKind,
      )
    )
      continue;
    const location = orgSettingKey(scope.orgId, key);
    const removed =
      options.transaction === undefined
        ? await deleteSetting(location)
        : await deleteSettingIfValue(location, value, {
            transaction: options.transaction,
          });
    if (!removed && options.transaction)
      fail("The connection annotations changed during cleanup.", {
        statusCode: 409,
        errorCode: "data_resource_cleanup_incomplete",
      });
    if (removed) {
      deleted += 1;
      if (options.transaction) noteOrgDataChange(scope.orgId, key);
    }
  }
  return { deleted };
}

export type ConnectionDeletionState = "deleting" | "deleted";
const deletionRecordSchema = z
  .object({ state: z.enum(["deleting", "deleted"]), startedAt: z.string() })
  .strict();
const deletionMutationValidation = {
  validateStoredValue: (value: unknown) => {
    if (!deletionRecordSchema.safeParse(value).success)
      fail("The connection deletion record could not be read.", {
        statusCode: 500,
        errorCode: "data_connection_deletion_corrupt",
      });
  },
};

function deletionKey(connectionId: string): string {
  return `${DELETION_KEY_PREFIX}:${encodeURIComponent(connectionId)}`;
}

/** Terminal app-deletion record; kept after completion to block late writers. */
export async function beginConnectionDeletion(
  scope: WorkspaceScope,
  connectionId: string,
  options: MetadataStoreOptions = {},
): Promise<void> {
  await mutateOrgSetting(
    scope.orgId,
    deletionKey(connectionId),
    (current) => ({
      state: current?.state === "deleted" ? "deleted" : "deleting",
      startedAt:
        typeof current?.startedAt === "string"
          ? current.startedAt
          : new Date().toISOString(),
    }),
    { ...options, ...deletionMutationValidation },
  );
  if (options.transaction)
    noteOrgDataChange(scope.orgId, deletionKey(connectionId));
}

export async function finishConnectionDeletion(
  scope: WorkspaceScope,
  connectionId: string,
  options: MetadataStoreOptions = {},
): Promise<void> {
  await mutateOrgSetting(
    scope.orgId,
    deletionKey(connectionId),
    (current) => ({
      state: "deleted",
      startedAt:
        typeof current?.startedAt === "string"
          ? current.startedAt
          : new Date().toISOString(),
    }),
    { ...options, ...deletionMutationValidation },
  );
  if (options.transaction)
    noteOrgDataChange(scope.orgId, deletionKey(connectionId));
}

export async function readConnectionDeletionState(
  scope: WorkspaceScope,
  connectionId: string,
  options: MetadataStoreOptions = {},
): Promise<ConnectionDeletionState | null> {
  const entry = await getSettingEntry(
    orgSettingKey(scope.orgId, deletionKey(connectionId)),
    options,
  );
  if (!entry.found) return null;
  const parsed = deletionRecordSchema.safeParse(entry.value);
  if (!parsed.success)
    fail("The connection deletion record could not be read.", {
      statusCode: 500,
      errorCode: "data_connection_deletion_corrupt",
    });
  return parsed.data.state;
}

/** Every annotation write re-checks the tombstone it may have raced with. */
export async function assertConnectionWritable(
  scope: WorkspaceScope,
  connectionId: string,
  options: MetadataStoreOptions = {},
): Promise<void> {
  const state = await readConnectionDeletionState(scope, connectionId, options);
  if (state !== null) {
    fail(
      state === "deleted"
        ? "This data connection was deleted."
        : "This data connection is being deleted.",
      {
        statusCode: 409,
        errorCode:
          state === "deleted"
            ? "data_connection_deleted"
            : "data_connection_deleting",
      },
    );
  }
}

const resourcePolicyRevisionSchema = z
  .object({
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

function resourcePolicyRevisionKey(connectionId: string): string {
  return `analytics.data.resource-policy:v1:${encodeURIComponent(connectionId)}`;
}

export async function readResourcePolicyRevision(
  scope: WorkspaceScope,
  connectionId: string,
  options: MetadataStoreOptions = {},
): Promise<number> {
  const entry = await getSettingEntry(
    orgSettingKey(scope.orgId, resourcePolicyRevisionKey(connectionId)),
    options,
  );
  if (!entry.found) return 0;
  const parsed = z
    .object({ revision: z.number().int().nonnegative() })
    .strict()
    .safeParse(entry.value);
  if (!parsed.success)
    fail("The data resource policy could not be read.", {
      statusCode: 500,
      errorCode: "data_resource_policy_corrupt",
    });
  return parsed.data.revision;
}
