export const CONTENT_MUTATION_RESOURCE_IDENTIFIERS = [
  "documents",
  "contentDatabases",
  "contentDatabaseItems",
  "documentPropertyDefinitions",
  "documentPropertyValues",
  "documentBlockFieldContents",
  "documentVersions",
] as const;

export type ContentMutationResource =
  (typeof CONTENT_MUTATION_RESOURCE_IDENTIFIERS)[number];

export const CONTENT_MUTATION_TRIGGER_FAMILIES = [
  "item_created",
  "item_submitted",
  "property_changed",
] as const;

export type ContentMutationTriggerFamily =
  (typeof CONTENT_MUTATION_TRIGGER_FAMILIES)[number];

export type ContentMutationCertification =
  | "certified"
  | "excluded_by_definition"
  | "disabled_missing_adapter";

export interface ContentMutationManifestEntry {
  path: string;
  resources: readonly ContentMutationResource[];
  triggerFamilies: Readonly<
    Record<ContentMutationTriggerFamily, ContentMutationCertification>
  >;
}

const certified = (
  path: string,
  resources: readonly ContentMutationResource[],
  families: readonly ContentMutationTriggerFamily[],
): ContentMutationManifestEntry => ({
  path,
  resources,
  triggerFamilies: {
    item_created: families.includes("item_created")
      ? "certified"
      : "excluded_by_definition",
    item_submitted: "excluded_by_definition",
    property_changed: families.includes("property_changed")
      ? "certified"
      : "excluded_by_definition",
  },
});

const disabled = (
  path: string,
  resources: readonly ContentMutationResource[],
  families: readonly ContentMutationTriggerFamily[] = ["item_created"],
): ContentMutationManifestEntry => ({
  path,
  resources,
  triggerFamilies: {
    item_created: families.includes("item_created")
      ? "disabled_missing_adapter"
      : "excluded_by_definition",
    item_submitted: families.includes("item_submitted")
      ? "disabled_missing_adapter"
      : "excluded_by_definition",
    property_changed: families.includes("property_changed")
      ? "disabled_missing_adapter"
      : "excluded_by_definition",
  },
});

const atomicSubmission = (
  path: string,
  resources: readonly ContentMutationResource[],
): ContentMutationManifestEntry => ({
  path,
  resources,
  triggerFamilies: {
    item_created: "excluded_by_definition",
    item_submitted: "certified",
    property_changed: "excluded_by_definition",
  },
});

/**
 * Executable inventory of production Content write paths. Each entry
 * classifies every trigger family independently. A trigger can only
 * become available when every relevant mutation path is either certified or
 * explicitly outside that trigger's definition.
 */
export const CONTENT_MUTATION_CERTIFICATION_MANIFEST = [
  disabled("actions/_builder-docs-client.ts", ["documents"]),
  disabled("actions/_content-database-lifecycle.ts", ["contentDatabases"]),
  disabled("actions/_content-files.ts", ["contentDatabaseItems", "documents"]),
  disabled("actions/_content-spaces.ts", [
    "contentDatabaseItems",
    "contentDatabases",
    "documents",
  ]),
  disabled("actions/_database-row-batch.ts", [
    "contentDatabaseItems",
    "documents",
  ]),
  disabled("actions/_database-source-utils.ts", [
    "contentDatabaseItems",
    "contentDatabases",
    "documentPropertyDefinitions",
    "documentPropertyValues",
    "documents",
  ]),
  disabled("actions/_database-utils.ts", [
    "contentDatabaseItems",
    "contentDatabases",
    "documentBlockFieldContents",
    "documentPropertyDefinitions",
    "documentPropertyValues",
  ]),
  disabled("actions/_property-utils.ts", [
    "contentDatabases",
    "documentBlockFieldContents",
    "documentPropertyDefinitions",
    "documents",
  ]),
  disabled("actions/add-content-database-source-field-property.ts", [
    "documentPropertyDefinitions",
    "documentPropertyValues",
  ]),
  atomicSubmission("actions/_content-database-item-mutations.ts", [
    "contentDatabaseItems",
    "contentDatabases",
    "documentBlockFieldContents",
    "documentPropertyValues",
    "documents",
  ]),
  disabled("actions/bind-content-database-source-field.ts", [
    "documentPropertyValues",
  ]),
  disabled("actions/change-content-database-source-role.ts", [
    "contentDatabaseItems",
  ]),
  disabled("actions/configure-document-property.ts", [
    "documentBlockFieldContents",
    "documentPropertyDefinitions",
    "documentPropertyValues",
  ]),
  disabled("actions/create-content-database.ts", [
    "contentDatabases",
    "documents",
  ]),
  certified("actions/create-document.ts", ["documents"], []),
  disabled("actions/create-inline-content-database.ts", ["contentDatabases"]),
  certified("actions/delete-content-database.ts", ["contentDatabases"], []),
  disabled("actions/delete-document-property.ts", [
    "contentDatabases",
    "documentBlockFieldContents",
    "documentPropertyDefinitions",
    "documentPropertyValues",
    "documents",
  ]),
  disabled("actions/delete-document.ts", [
    "contentDatabaseItems",
    "contentDatabases",
    "documentBlockFieldContents",
    "documentPropertyDefinitions",
    "documentPropertyValues",
    "documentVersions",
    "documents",
  ]),
  disabled("actions/disconnect-local-folder-source.ts", ["documents"]),
  certified(
    "actions/duplicate-database-item.ts",
    ["contentDatabaseItems", "documentPropertyValues", "documents"],
    ["item_created"],
  ),
  certified(
    "actions/duplicate-database-items.ts",
    ["contentDatabaseItems", "documentPropertyValues", "documents"],
    ["item_created"],
  ),
  disabled("actions/duplicate-document-property.ts", [
    "documentPropertyDefinitions",
    "documentPropertyValues",
  ]),
  certified("actions/edit-document.ts", ["documents"], []),
  disabled("actions/import-content-source.ts", [
    "documentVersions",
    "documents",
  ]),
  disabled("actions/manage-content-database-policy.ts", ["contentDatabases"]),
  disabled("actions/manage-content-database-validation.ts", [
    "contentDatabases",
  ]),
  disabled("actions/materialize-builder-required-fields.ts", [
    "documentPropertyDefinitions",
    "documentPropertyValues",
  ]),
  certified(
    "actions/move-database-item.ts",
    ["contentDatabaseItems", "documents"],
    [],
  ),
  disabled("actions/move-document.ts", ["contentDatabases", "documents"]),
  disabled("actions/remove-local-file-source.ts", ["documents"]),
  disabled("actions/reorder-document-property.ts", [
    "documentPropertyDefinitions",
  ]),
  disabled("actions/resolve-local-folder-conflict.ts", [
    "documentVersions",
    "documents",
  ]),
  certified("actions/restore-content-database.ts", ["contentDatabases"], []),
  certified(
    "actions/restore-document-version.ts",
    ["documentVersions", "documents"],
    [],
  ),
  disabled("actions/set-document-discoverability.ts", ["documents"]),
  certified(
    "actions/set-document-property.ts",
    ["documentBlockFieldContents", "documentPropertyValues", "documents"],
    ["property_changed"],
  ),
  disabled("actions/share-local-file-document.ts", ["documents"]),
  disabled("actions/stage-builder-source-bulk-update.ts", [
    "documentPropertyValues",
  ]),
  disabled("actions/sync-local-folder-source.ts", [
    "documentVersions",
    "documents",
  ]),
  disabled("actions/update-content-database-view.ts", ["contentDatabases"]),
  disabled("actions/update-document.ts", [
    "contentDatabases",
    "documentVersions",
    "documents",
  ]),
  disabled("server/lib/native-creative-context.ts", ["documentVersions"]),
  disabled("server/lib/notion-sync.ts", ["documentVersions", "documents"]),
] as const satisfies readonly ContentMutationManifestEntry[];

export function contentMutationTriggerCoverage(
  family: ContentMutationTriggerFamily,
) {
  const missingPaths = CONTENT_MUTATION_CERTIFICATION_MANIFEST.filter(
    (entry) => entry.triggerFamilies[family] === "disabled_missing_adapter",
  ).map((entry) => entry.path);
  const certifiedPaths = CONTENT_MUTATION_CERTIFICATION_MANIFEST.filter(
    (entry) => entry.triggerFamilies[family] === "certified",
  ).map((entry) => entry.path);
  return {
    available: missingPaths.length === 0 && certifiedPaths.length > 0,
    certifiedPaths,
    missingPaths,
  };
}
