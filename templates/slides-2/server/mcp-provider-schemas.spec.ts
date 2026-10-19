import { beforeAll, describe, expect, it } from "vitest";

import {
  LOAD_TIMEOUT_MS,
  jsonSchemaViolations,
  loadAppCatalogs,
  type AppCatalog,
} from "../../../packages/core/test-support/advertised-catalog.js";

let slides2: AppCatalog;

beforeAll(async () => {
  const [app] = await loadAppCatalogs(["slides-2"]);
  if (!app) throw new Error("Slides 2 did not produce an MCP catalog.");
  slides2 = app;
}, LOAD_TIMEOUT_MS);

describe("Slides 2 MCP provider schemas", () => {
  it("keeps every advertised tool schema valid JSON Schema 2020-12", () => {
    const tools = slides2.surfaces
      .flatMap((surface) => [
        ...surface.catalogs.default,
        ...surface.catalogs.full,
      ])
      .filter((tool) => slides2.templateActionNames.has(tool.name));
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.flatMap((tool) => jsonSchemaViolations(tool))).toEqual([]);
  });
});
