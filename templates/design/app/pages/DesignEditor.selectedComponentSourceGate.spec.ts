import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("DesignEditor selectedComponentSource query gate", () => {
  const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");

  it("only fires read-local-file for a caller with editor access", () => {
    const queryStart = editorSource.indexOf(
      "const { data: selectedComponentSource } = useActionQuery<",
    );
    expect(queryStart).toBeGreaterThan(-1);
    const queryRegion = editorSource
      .slice(queryStart, queryStart + 900)
      .replace(/\s+/g, " ");

    expect(queryRegion).toContain('"read-local-file"');
    expect(queryRegion).toContain(
      "enabled: Boolean( id && selectedComponentLocalSourceAnchor && canEditDesign, )",
    );
  });
});
