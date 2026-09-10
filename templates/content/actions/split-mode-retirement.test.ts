import fs from "node:fs/promises";

import { describe, expect, it } from "vitest";

const canonicalDocumentActions = [
  "create-document.ts",
  "delete-document.ts",
  "move-document.ts",
  "search-documents.ts",
  "pull-document.ts",
  "list-documents.ts",
  "get-document.ts",
  "edit-document.ts",
  "update-document.ts",
  "view-screen.ts",
  "reveal-local-source-file.ts",
  "remove-local-file-source.ts",
];

describe("Content split-mode retirement", () => {
  it("keeps canonical document actions on the SQL path regardless of process mode", async () => {
    for (const file of canonicalDocumentActions) {
      const source = await fs.readFile(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toContain("AGENT_NATIVE_MODE");
      expect(source, file).not.toContain("AGENT_NATIVE_DATA_MODE");
      expect(source, file).not.toContain("isContentLocalFileMode");
      expect(source, file).not.toContain("LocalFileDocument");
    }
  });

  it("does not include the global mode selector in the explicit local-artifact compatibility cache", async () => {
    const source = await fs.readFile(
      new URL("_local-file-documents.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("AGENT_NATIVE_MODE");
    expect(source).not.toContain("AGENT_NATIVE_DATA_MODE");
    expect(source).not.toContain("isAgentNativeLocalFileMode");
  });
});
