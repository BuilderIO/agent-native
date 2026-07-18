import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contentHookTriggerAvailability } from "../../actions/_content-database-hooks.js";
import {
  CONTENT_MUTATION_CERTIFICATION_MANIFEST,
  CONTENT_MUTATION_RESOURCE_IDENTIFIERS,
  CONTENT_MUTATION_TRIGGER_FAMILIES,
  type ContentMutationResource,
} from "./mutation-certification-manifest.js";

const templateRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const resourceSet = new Set<string>(CONTENT_MUTATION_RESOURCE_IDENTIFIERS);
const physicalNames: Record<ContentMutationResource, string> = {
  documents: "documents",
  contentDatabases: "content_databases",
  contentDatabaseItems: "content_database_items",
  documentPropertyDefinitions: "document_property_definitions",
  documentPropertyValues: "document_property_values",
  documentBlockFieldContents: "document_block_field_contents",
  documentVersions: "document_versions",
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (
      !entry.name.endsWith(".ts") ||
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".spec.ts")
    ) {
      return [];
    }
    return [path];
  });
}

export function inventoryContentMutations(
  source: string,
): Set<ContentMutationResource> {
  const found = new Set<ContentMutationResource>();
  const aliases = new Map<string, ContentMutationResource>();
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*schema\.([A-Za-z_$][\w$]*)/g,
  )) {
    if (resourceSet.has(match[2])) {
      aliases.set(match[1], match[2] as ContentMutationResource);
    }
  }
  for (const match of source.matchAll(
    /\.(?:insert|update|delete)\s*\(\s*(?:schema\.([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))/g,
  )) {
    const resource = match[1]
      ? (match[1] as ContentMutationResource)
      : aliases.get(match[2]);
    if (resource && resourceSet.has(resource)) found.add(resource);
  }
  for (const resource of CONTENT_MUTATION_RESOURCE_IDENTIFIERS) {
    const table = physicalNames[resource];
    const rawMutation = new RegExp(
      "\\b(?:insert\\s+(?:or\\s+\\w+\\s+)?into|update|delete\\s+from|replace\\s+into)\\s+[`\"']?" +
        table +
        "[`\"']?\\b",
      "i",
    );
    if (rawMutation.test(source)) found.add(resource);
  }
  return found;
}

describe("Content mutation certification manifest", () => {
  it("recognizes direct, helper-aliased, and generic raw-SQL bypasses", () => {
    const source = `
      const items = schema.contentDatabaseItems;
      await tx.insert(schema.documents).values(row);
      await helper.update(items).set(values);
      await genericTool.execute(sql\`DELETE FROM document_property_values WHERE id = \${id}\`);
    `;
    expect([...inventoryContentMutations(source)].sort()).toEqual([
      "contentDatabaseItems",
      "documentPropertyValues",
      "documents",
    ]);
  });

  it("classifies every protected production write path exactly", () => {
    const actual = new Map<string, ContentMutationResource[]>();
    for (const root of ["actions", "server/lib", "server/routes"]) {
      for (const path of sourceFiles(join(templateRoot, root))) {
        const resources = [
          ...inventoryContentMutations(readFileSync(path, "utf8")),
        ].sort();
        if (resources.length) {
          actual.set(relative(templateRoot, path), resources);
        }
      }
    }
    const expected = new Map(
      CONTENT_MUTATION_CERTIFICATION_MANIFEST.map((entry) => [
        entry.path,
        [...entry.resources].sort(),
      ]),
    );
    expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
  });

  it("derives trigger availability from the executable coverage manifest", () => {
    for (const entry of CONTENT_MUTATION_CERTIFICATION_MANIFEST) {
      expect(Object.keys(entry.triggerFamilies).sort()).toEqual(
        [...CONTENT_MUTATION_TRIGGER_FAMILIES].sort(),
      );
    }
    expect(
      CONTENT_MUTATION_CERTIFICATION_MANIFEST.some(
        (entry) =>
          entry.triggerFamilies.item_created === "disabled_missing_adapter",
      ),
    ).toBe(true);
    expect(
      CONTENT_MUTATION_CERTIFICATION_MANIFEST.some(
        (entry) => entry.triggerFamilies.property_changed === "certified",
      ),
    ).toBe(true);
    expect(
      CONTENT_MUTATION_CERTIFICATION_MANIFEST.some(
        (entry) =>
          entry.triggerFamilies.property_changed === "disabled_missing_adapter",
      ),
    ).toBe(false);
    expect(
      CONTENT_MUTATION_CERTIFICATION_MANIFEST.find(
        (entry) => entry.path === "actions/_content-database-item-mutations.ts",
      )?.triggerFamilies,
    ).toEqual({
      item_created: "excluded_by_definition",
      item_submitted: "certified",
      property_changed: "excluded_by_definition",
    });
    const availability = new Map(
      contentHookTriggerAvailability.map((entry) => [entry.kind, entry]),
    );
    expect(availability.size).toBe(contentHookTriggerAvailability.length);
    expect(availability.get("item_created")).toMatchObject({
      available: false,
    });
    expect(availability.get("item_submitted")).toMatchObject({
      available: true,
    });
    expect(availability.get("property_changed")).toMatchObject({
      available: true,
    });
    expect(availability.get("builder_publication_confirmed")).toMatchObject({
      available: true,
    });
  });
});
