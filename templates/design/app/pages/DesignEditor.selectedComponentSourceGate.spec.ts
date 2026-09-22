import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// read-local-file is editor-only (assertAccess('design', id, 'editor')
// server-side): it reads through the design owner's local bridge. Without
// this gate, every anonymous public viewer on /visual-edit/:id who selected
// a component fired a guaranteed 401 (see the design-401-flags-labs /
// read-local-file-capability-gate-mismatch reliability findings). Asserted
// as source text, matching this file's other single-region checks — see
// design-editor-architecture's note that DesignEditor.tsx behavior is
// mostly proven this way when it isn't extracted into a command module.
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
