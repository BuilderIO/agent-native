import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

describe("DesignEditor selectedComponentSource query gate", () => {
  const editorSource = readDesignEditorSource();

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
