import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { resolveAccess } from "@agent-native/core/sharing";
import "../server/db/index.js"; // ensure registerShareableResource runs

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getExportDir(path: typeof import("path")): string {
  if (process.env.NODE_ENV === "production") {
    return path.join(process.cwd(), "data", "exports");
  }

  return path.join(
    process.cwd(),
    "node_modules",
    ".cache",
    "agent-native-design",
    "exports",
  );
}

export default defineAction({
  description:
    "Export a design project as a standalone HTML file with Tailwind CSS and Alpine.js included via CDN. " +
    "Bundles all HTML, CSS, and JSX files into a single self-contained page. " +
    "Returns the HTML string and suggested filename.",
  schema: z.object({
    id: z.string().describe("Design ID to export"),
  }),
  run: async ({ id }) => {
    const access = await resolveAccess("design", id);
    if (!access) throw new Error(`Design not found: ${id}`);

    const row = access.resource;
    const db = getDb();

    // Fetch all design files
    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, id));

    const cssFiles = files.filter((f) => f.fileType === "css");
    const htmlFiles = files.filter((f) => f.fileType === "html");
    const jsxFiles = files.filter((f) => f.fileType === "jsx");
    const indexHtml =
      files.find((f) => f.filename === "index.html") ?? htmlFiles[0];
    const combinedCss = cssFiles.map((f) => f.content).join("\n\n");

    let html: string;
    if (
      indexHtml?.content &&
      /<!doctype html|<html[\s>]/i.test(indexHtml.content)
    ) {
      html = indexHtml.content;
      // Merge non-index HTML/JSX files into the body of the standalone
      // document so multi-file designs (components.html, page-*.html, etc.)
      // still ship in one bundle. Drop the file we already used as the
      // shell so we don't double-include it.
      const extraBody = [...htmlFiles, ...jsxFiles]
        .filter((f) => f !== indexHtml)
        .map((f) => f.content)
        .join("\n\n");
      if (extraBody.trim()) {
        // Find the last closing body tag. Inline JS / template literals
        // can contain `</body>` strings, so a naive replace can mishit —
        // use lastIndexOf which favors the real document boundary.
        const closeBody = html.lastIndexOf("</body>");
        if (closeBody !== -1) {
          html = `${html.slice(0, closeBody)}${extraBody}\n${html.slice(closeBody)}`;
        } else {
          html = `${html}\n${extraBody}`;
        }
      }
      // Idempotency: if a prior export already injected this CSS block,
      // skip re-injection so repeated exports don't duplicate the style
      // tag. The `data-agent-native-export` marker is our sentinel.
      if (
        combinedCss.trim() &&
        !/<style[^>]*data-agent-native-export\b/i.test(html)
      ) {
        const styleBlock = `<style data-agent-native-export>\n${combinedCss}\n</style>`;
        // Match the LAST `</head>` (not the first appearance inside an
        // inline script / comment) to avoid injecting before content
        // that depends on the document's own styles.
        const closeHead = html.lastIndexOf("</head>");
        if (closeHead !== -1) {
          html = `${html.slice(0, closeHead)}${styleBlock}\n${html.slice(closeHead)}`;
        } else {
          html = `${styleBlock}\n${html}`;
        }
      }
    } else {
      const combinedBody = [...htmlFiles, ...jsxFiles]
        .map((f) => f.content)
        .join("\n\n");

      html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(row.title)}</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script>
  <style>
    ${combinedCss}
  </style>
</head>
<body>
  ${combinedBody}
</body>
</html>`;
    }

    // Save to exports directory
    const fs = await import("fs");
    const path = await import("path");
    const exportDir = getExportDir(path);
    fs.mkdirSync(exportDir, { recursive: true });
    const filename = `${row.title.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}.html`;
    const filePath = path.join(exportDir, filename);
    fs.writeFileSync(filePath, html);

    return { html, filename, filePath, fileCount: files.length };
  },
});
