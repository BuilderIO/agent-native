import { describe, expect, it } from "vitest";

import {
  normalizeImportedHtmlDocument,
  sanitizeImportedFilename,
} from "./import-design-files.js";

describe("import design file helpers", () => {
  it("rejects path traversal filenames", () => {
    expect(() => sanitizeImportedFilename("../secret.html")).toThrow(
      /invalid/i,
    );
    expect(() => sanitizeImportedFilename("nested/file.html")).toThrow(
      /invalid/i,
    );
  });

  it("normalizes plain snippets into standalone HTML", () => {
    const html = normalizeImportedHtmlDocument("<main>Hello</main>", "test");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Imported into Design from test");
    expect(html).toContain("<main>Hello</main>");
  });

  it("stamps existing documents inside head", () => {
    const html = normalizeImportedHtmlDocument(
      "<!doctype html><html><head></head><body>Hi</body></html>",
      "upload",
    );

    expect(html).toContain(
      "<head>\n  <!-- Imported into Design from upload. -->",
    );
  });
});
