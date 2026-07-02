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

  it("strips executable HTML before persistence", () => {
    const html = normalizeImportedHtmlDocument(
      `<main onclick="alert(1)">
        <script>alert(1)</script>
        <a href="javascript:alert(1)">bad</a>
        <iframe srcdoc="<script>alert(1)</script>"></iframe>
      </main>`,
      "upload",
    );

    expect(html).toContain("<main>");
    expect(html).toContain("<a>bad</a>");
    expect(html).not.toMatch(/script|onclick|javascript:|iframe|srcdoc/i);
  });
});
