import type { BlocksFieldExport } from "./document-export.js";

// A page export carries its Blocks fields, with their block identities, in a
// manifest a reader never sees: a comment ending Markdown, a script in HTML.

const MARKDOWN_MANIFEST_START = "<!-- agent-native-blocks:";
const MARKDOWN_MANIFEST_END = " -->";

export interface ExportManifestField {
  name: string;
  /** Null in exports made before the manifest named the primary field. */
  primary: boolean | null;
  markdown: string;
}

export type ExportManifest =
  | { kind: "absent" }
  | { kind: "read"; fields: ExportManifestField[] }
  | { kind: "unreadable"; reason: string };

export function serializeBlocksFieldsManifest(
  fields: BlocksFieldExport[],
): string {
  return JSON.stringify({ version: 1, fields })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/--/g, "\\u002d\\u002d");
}

export function markdownWithBlocksFieldsManifest(
  markdown: string,
  manifest: string,
): string {
  return `${markdown.trimEnd()}\n\n${MARKDOWN_MANIFEST_START}${manifest}${MARKDOWN_MANIFEST_END}\n`;
}

export function htmlWithBlocksFieldsManifest(
  html: string,
  manifest: string,
): string {
  return html.replace(
    "</body>",
    `<script type="application/json" id="agent-native-blocks">${manifest}</script>\n</body>`,
  );
}

/** Splits the manifest a Markdown export ends with off its body. */
export function splitMarkdownExportManifest(text: string): {
  body: string;
  manifest: ExportManifest;
} {
  const start = text.lastIndexOf(MARKDOWN_MANIFEST_START);
  const line = start < 0 ? "" : text.slice(start).trimEnd();
  // Only the last line can be the manifest; the marker anywhere else is text.
  if (
    start < 0 ||
    (start > 0 && text[start - 1] !== "\n") ||
    line.includes("\n")
  )
    return { body: text, manifest: { kind: "absent" } };
  return {
    body: `${text.slice(0, start).trimEnd()}\n`,
    manifest: line.endsWith(MARKDOWN_MANIFEST_END)
      ? readBlocksFieldsManifest(
          line.slice(
            MARKDOWN_MANIFEST_START.length,
            -MARKDOWN_MANIFEST_END.length,
          ),
        )
      : { kind: "unreadable", reason: "the manifest comment is not closed" },
  };
}

function readBlocksFieldsManifest(json: string): ExportManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      kind: "unreadable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const manifest = parsed as { version?: unknown; fields?: unknown } | null;
  if (manifest?.version !== 1 || !Array.isArray(manifest.fields))
    return { kind: "unreadable", reason: "not a version 1 manifest" };
  const fields: ExportManifestField[] = [];
  for (const entry of manifest.fields as unknown[]) {
    const field = entry as Partial<Record<keyof BlocksFieldExport, unknown>>;
    if (typeof field?.name !== "string" || typeof field.markdown !== "string")
      return { kind: "unreadable", reason: "a field has no name or Markdown" };
    fields.push({
      name: field.name,
      primary: typeof field.primary === "boolean" ? field.primary : null,
      markdown: field.markdown,
    });
  }
  return { kind: "read", fields };
}
