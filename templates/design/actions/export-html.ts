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

    // Separate files by type
    const htmlFiles = files.filter(
      (f) => f.fileType === "html" || f.fileType === "jsx",
    );
    const cssFiles = files.filter((f) => f.fileType === "css");

    // Combine CSS
    const combinedCss = cssFiles.map((f) => f.content).join("\n\n");

    // Combine HTML body content
    const combinedBody = htmlFiles.map((f) => f.content).join("\n\n");

    const html = `<!DOCTYPE html>
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

    // Save to exports directory
    const fs = await import("fs");
    const path = await import("path");
    const exportDir = path.join(process.cwd(), "data", "exports");
    fs.mkdirSync(exportDir, { recursive: true });
    const filename = `${row.title.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}.html`;
    const filePath = path.join(exportDir, filename);
    fs.writeFileSync(filePath, html);

    return { html, filename, filePath, fileCount: files.length };
  },
});
