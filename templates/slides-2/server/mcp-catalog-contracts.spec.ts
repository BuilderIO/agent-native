import { beforeAll, describe, expect, it } from "vitest";

import type { ActionEntry } from "../../../packages/core/src/agent/production-agent.js";
import {
  LOAD_TIMEOUT_MS,
  defaultProductionTools,
  loadAppCatalogs,
  type AppCatalog,
  type SurfaceCatalog,
} from "../../../packages/core/test-support/advertised-catalog.js";

const BACKTICKED = /`([^`]+)`/g;
const COMPOUND_WORD =
  /(?<![\w-])[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+(?![\w-])/g;
const NOT_TOOL_NAMES = {
  ...prose(
    "hyphenated prose in the shared instructions",
    "Agent-Native",
    "page-local",
    "state-dependent",
    "full-document",
    "built-in",
    "in-app",
    "App-specific",
  ),
};

const HINTS = ["readOnlyHint", "destructiveHint", "openWorldHint"] as const;

let app: AppCatalog;

function prose(reason: string, ...tokens: string[]) {
  return Object.fromEntries(tokens.map((token) => [token, reason]));
}

function advertisements(catalog: AppCatalog) {
  return catalog.surfaces.flatMap((surface: SurfaceCatalog) =>
    (["default", "full"] as const).flatMap((mode) =>
      surface.catalogs[mode].map((tool) => ({
        tool,
        entry: surface.entries[tool.name],
      })),
    ),
  );
}

function isReadOnlyAction(entry: ActionEntry): boolean {
  return entry.readOnly === true;
}

function undeclaredMutatingActions(catalog: AppCatalog): string[] {
  const names = new Set<string>();
  for (const { tool, entry } of advertisements(catalog)) {
    if (
      entry &&
      catalog.templateActionNames.has(tool.name) &&
      !isReadOnlyAction(entry) &&
      typeof entry.mcpAnnotations?.destructiveHint !== "boolean"
    ) {
      names.add(tool.name);
    }
  }
  return [...names].sort();
}

function readOnlyMismatches(catalog: AppCatalog): string[] {
  return advertisements(catalog)
    .filter(
      ({ tool, entry }) =>
        entry &&
        catalog.templateActionNames.has(tool.name) &&
        tool.annotations.readOnlyHint !== isReadOnlyAction(entry),
    )
    .map(({ tool }) => tool.name)
    .sort();
}

function declaredAnnotationMismatches(catalog: AppCatalog): string[] {
  return advertisements(catalog)
    .filter(({ tool, entry }) => {
      if (!entry || !catalog.templateActionNames.has(tool.name)) return false;
      const declared = entry.mcpAnnotations;
      return (
        declared !== undefined &&
        HINTS.some((hint) => declared[hint] !== tool.annotations[hint])
      );
    })
    .map(({ tool }) => tool.name)
    .sort();
}

function toolReferences(text: string): Set<string> {
  const references = new Set<string>();
  for (const [, token] of text.matchAll(BACKTICKED)) {
    references.add(token!.trim());
  }
  for (const [word] of text.replace(BACKTICKED, " ").matchAll(COMPOUND_WORD)) {
    references.add(word);
  }
  return references;
}

beforeAll(async () => {
  const [slides2] = await loadAppCatalogs(["slides-2"]);
  if (!slides2) throw new Error("Slides 2 did not produce an MCP catalog.");
  app = slides2;
}, LOAD_TIMEOUT_MS);

describe("Slides 2 MCP catalog contracts", () => {
  it("attributes app actions separately from framework actions", () => {
    const advertised = new Set(
      advertisements(app).map(({ tool }) => tool.name),
    );
    expect(advertised.has("share-resource")).toBe(true);
    expect(advertised.has("get-deck")).toBe(true);
    expect(advertised.has("delete-staged-dataset")).toBe(true);
    expect(advertised.has("provider-api-request")).toBe(true);
    expect(advertised.has("extract-pdf")).toBe(false);
    expect(advertised.has("generate-image")).toBe(false);
    expect(app.templateActionNames.has("share-resource")).toBe(false);
    expect(app.templateActionNames.has("get-deck")).toBe(true);
    expect(app.templateActionNames.has("delete-staged-dataset")).toBe(false);
    expect(app.templateActionNames.has("provider-api-request")).toBe(false);
    expect(app.devDiscoveredTools.has("extract-pdf")).toBe(false);
    expect(app.devDiscoveredTools.has("generate-image")).toBe(false);
    expect(app.templateActionNames.has("get-deck") ? app.appId : "core").toBe(
      "slides-2",
    );
    expect(
      app.templateActionNames.has("delete-staged-dataset") ? app.appId : "core",
    ).toBe("core");
    expect(
      app.templateActionNames.has("provider-api-request") ? app.appId : "core",
    ).toBe("core");
  });

  it("requires every advertised mutating app action to declare destructiveHint", () => {
    expect(undeclaredMutatingActions(app)).toEqual([]);
  });

  it("keeps advertised read-only hints aligned with action metadata", () => {
    expect(readOnlyMismatches(app)).toEqual([]);
  });

  it("keeps every declared MCP hint aligned with the advertised tool", () => {
    expect(declaredAnnotationMismatches(app)).toEqual([]);
  });
});

describe("Slides 2 static MCP instructions", () => {
  it("name only tools in the default catalog or classified prose", () => {
    const advertised = new Set(
      defaultProductionTools(app).map((tool) => tool.name),
    );
    const unclassified = [...toolReferences(app.instructions)].filter(
      (reference) =>
        !advertised.has(reference) && !Object.hasOwn(NOT_TOOL_NAMES, reference),
    );
    expect(unclassified).toEqual([]);
  });

  it("keeps prose classifications limited to tokens still present", () => {
    const mentioned = toolReferences(app.instructions);
    expect(
      Object.keys(NOT_TOOL_NAMES).filter((token) => !mentioned.has(token)),
    ).toEqual([]);
  });
});
