import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("get-motion-timeline access model", () => {
  it("uses resource access instead of list filtering so public localhost designs can hydrate timelines", () => {
    const actionPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "get-motion-timeline.ts",
    );
    const src = readFileSync(actionPath, "utf8");

    expect(src).toContain('assertAccess("design", designId, "viewer")');
    expect(src).not.toContain(
      "accessFilter(schema.designs, schema.designShares)",
    );
  });
});
