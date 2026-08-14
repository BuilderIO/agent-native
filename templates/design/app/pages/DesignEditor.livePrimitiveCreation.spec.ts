import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DesignEditor.tsx", import.meta.url), {
  encoding: "utf8",
});
// handleCreatePrimitive now lives in its own command module.
const createPrimitiveSource = readFileSync(
  new URL("./design-editor/commands/create-primitive.ts", import.meta.url),
  { encoding: "utf8" },
);
const createPrimitiveStart = createPrimitiveSource.indexOf(
  "export function runCreatePrimitive",
);
const createPrimitiveEnd = createPrimitiveSource.length;
const recordPendingStart = source.indexOf(
  "const recordPendingLiveStructureEdit",
);
const recordPendingEnd = source.indexOf(
  "const activeProjectionContent",
  recordPendingStart,
);
const recordPendingSource = source.slice(recordPendingStart, recordPendingEnd);

describe("DesignEditor live primitive creation boundary", () => {
  it("routes URL-backed screens through the live insert bridge without rewriting the route URL", () => {
    expect(createPrimitiveStart).toBeGreaterThan(0);
    expect(createPrimitiveEnd).toBeGreaterThan(createPrimitiveStart);
    expect(createPrimitiveSource).toContain(
      "if (isStandaloneHttpUrl(baseContent))",
    );
    expect(createPrimitiveSource).toContain("setRuntimeStructureInsertRequest");
    expect(createPrimitiveSource).toContain('anchor: { selector: "body" }');
    expect(createPrimitiveSource).toContain("extractCanvasPrimitiveHtml");
  });

  it("keeps every focused and overview creation tool on the shared handleCreatePrimitive path", () => {
    expect(source).toMatch(
      /const handleSingleScreenCreatePrimitive[\s\S]*?handleCreatePrimitive\(activeFile\.id, primitive\)/,
    );
    expect(source).toMatch(/onCreatePrimitive=\{handleCreatePrimitive\}/);
  });

  it("uses only manifest source provenance for a body-level Apply target", () => {
    expect(recordPendingStart).toBeGreaterThan(0);
    expect(recordPendingEnd).toBeGreaterThan(recordPendingStart);
    expect(recordPendingSource).toContain(
      "sourceFile: overviewScreen?.sourceFile",
    );
    expect(recordPendingSource).not.toContain("overviewScreen?.url");
  });
});
