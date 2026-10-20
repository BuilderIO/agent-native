import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

describe("Design editor pending generation hydration", () => {
  const editorSource = readDesignEditorSource();

  it("keeps the initial server and client render storage-independent", () => {
    expect(editorSource).toContain(
      "const [hasPendingGeneration, setHasPendingGeneration] = useState(false);",
    );
    expect(editorSource).not.toContain(
      "useState(() =>\n    hasFreshPendingGeneration(id)",
    );
  });

  it("reconciles pending generation storage after session hydration", () => {
    const reconciliationEffect = editorSource.match(
      /useEffect\(\(\) => \{\n    if \(!id \|\| !sessionResolved\) return;[\s\S]*?\n  \}, \[[\s\S]*?\n  \]\);/,
    )?.[0];

    expect(reconciliationEffect).toContain(
      "const pending = readPendingGeneration(id);",
    );
    expect(reconciliationEffect).toContain("sessionResolved,");
  });

  it("clears the generating indicator when confirmed output is present", () => {
    const outputEffect = editorSource.match(
      /useEffect\(\(\) => \{\n    if \(!id\) return;\n    const pending = readPendingGeneration\(id\);[\s\S]*?hasPendingGenerationOutput\(pending, files\)[\s\S]*?\n  \}, \[[\s\S]*?\n  \]\);/,
    )?.[0];

    expect(outputEffect).toContain("resetAgentGenerating();");
    expect(outputEffect).toContain("resetAgentGenerating");
  });
});
