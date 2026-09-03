import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Design editor pending generation hydration", () => {
  const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");

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
});
