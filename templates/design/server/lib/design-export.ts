export interface DesignExportFile {
  filename: string;
  fileType: string | null;
  content: string | null;
}

export interface DesignExportSaveResult {
  filePath?: string;
  saveWarning?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function safeExportBaseName(title: string | null | undefined): string {
  const safe = (title || "design")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe || "design";
}

export function exportFilename(
  title: string | null | undefined,
  extension: string,
): string {
  return `${safeExportBaseName(title)}-${Date.now()}.${extension}`;
}

export function buildStandaloneHtml(args: {
  title: string;
  files: DesignExportFile[];
}): string {
  const { title, files } = args;
  const cssFiles = files.filter((f) => f.fileType === "css");
  const htmlFiles = files.filter((f) => f.fileType === "html");
  const jsxFiles = files.filter((f) => f.fileType === "jsx");
  const indexHtml =
    files.find((f) => f.filename === "index.html") ?? htmlFiles[0];
  const combinedCss = cssFiles.map((f) => f.content ?? "").join("\n\n");

  if (
    indexHtml?.content &&
    /<!doctype html|<html[\s>]/i.test(indexHtml.content)
  ) {
    let html = indexHtml.content;
    // Merge non-index HTML/JSX files into the body of the standalone document
    // so multi-file designs still ship in one bundle.
    const extraBody = [...htmlFiles, ...jsxFiles]
      .filter((f) => f !== indexHtml)
      .map((f) => f.content ?? "")
      .join("\n\n");
    if (extraBody.trim()) {
      // Inline JS / template literals can contain `</body>` strings, so favor
      // the final document boundary.
      const closeBody = html.lastIndexOf("</body>");
      if (closeBody !== -1) {
        html = `${html.slice(0, closeBody)}${extraBody}\n${html.slice(closeBody)}`;
      } else {
        html = `${html}\n${extraBody}`;
      }
    }

    // Idempotency: if a prior export already injected this CSS block, skip
    // re-injection so repeated exports don't duplicate the style tag.
    if (
      combinedCss.trim() &&
      !/<style[^>]*data-agent-native-export\b/i.test(html)
    ) {
      const styleBlock = `<style data-agent-native-export>\n${combinedCss}\n</style>`;
      const closeHead = html.lastIndexOf("</head>");
      if (closeHead !== -1) {
        html = `${html.slice(0, closeHead)}${styleBlock}\n${html.slice(closeHead)}`;
      } else {
        html = `${styleBlock}\n${html}`;
      }
    }

    return html;
  }

  const combinedBody = [...htmlFiles, ...jsxFiles]
    .map((f) => f.content ?? "")
    .join("\n\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
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

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeHtmlForSvg(html: string): string {
  const withoutDoctype = html.replace(/<!doctype[^>]*>/i, "").trim();
  const withClosedVoidElements = withoutDoctype.replace(
    /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b([^>]*)>/gi,
    (match, tag: string, attrs: string) => {
      if (/\/\s*>$/.test(match)) return match;
      return `<${tag}${attrs} />`;
    },
  );
  const withEscapedBareAmpersands = withClosedVoidElements.replace(
    /&(?!#?[a-zA-Z0-9]+;)/g,
    "&amp;",
  );

  if (/<html\b[^>]*\bxmlns=/i.test(withEscapedBareAmpersands)) {
    return withEscapedBareAmpersands;
  }

  if (/<html\b/i.test(withEscapedBareAmpersands)) {
    return withEscapedBareAmpersands.replace(
      /<html\b/i,
      '<html xmlns="http://www.w3.org/1999/xhtml"',
    );
  }

  return `<html xmlns="http://www.w3.org/1999/xhtml"><body>${withEscapedBareAmpersands}</body></html>`;
}

export function buildSvgForeignObject(args: {
  html: string;
  width: number;
  height: number;
  title?: string | null;
}): string {
  const width = Math.max(1, Math.round(args.width));
  const height = Math.max(1, Math.round(args.height));
  const title = args.title ? escapeXmlAttribute(args.title) : "Design export";
  const html = normalizeHtmlForSvg(args.html);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
  <title>${title}</title>
  <foreignObject width="${width}" height="${height}">
${html}
  </foreignObject>
</svg>`;
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

export async function trySaveExportFile(
  filename: string,
  contents: string | Uint8Array,
): Promise<DesignExportSaveResult> {
  const fs = await import("fs");
  const path = await import("path");
  const exportDir = getExportDir(path);
  const filePath = path.join(exportDir, filename);

  try {
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(filePath, contents);
    return { filePath };
  } catch (error) {
    console.warn("Design export server-side save skipped:", error);
    return {
      saveWarning:
        "Could not save a server-side copy, but the download payload was created.",
    };
  }
}
