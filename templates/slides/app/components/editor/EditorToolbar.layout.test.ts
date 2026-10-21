import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const editorToolbarSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "EditorToolbar.tsx"),
  "utf8",
);

describe("EditorToolbar layout contract", () => {
  it("hides the save status pill only inside a read-only directory widget", () => {
    expect(editorToolbarSource).toContain(
      "const readOnlyWidget = useIsMcpDirectoryWidgetReadOnlyEmbed();",
    );
    expect(editorToolbarSource).toMatch(
      /\{!readOnlyWidget && \(canEdit \|\| saveFailed\) && \(\s*<SaveStatusIndicator/,
    );
  });

  it("opens the deck in the app through the host bridge", () => {
    expect(editorToolbarSource).toContain("openMcpAppHostLink(editorUrl)");
    expect(
      editorToolbarSource.match(/editorToolbar\.openInAgentNative/g),
    ).toHaveLength(2);
  });
});
