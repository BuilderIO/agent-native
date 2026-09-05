import { csvCell } from "./database-csv-export.js";
import { buildDocumentExport } from "./document-export.js";

export interface CollectionExportField {
  id: string;
  name: string;
}

export interface CollectionExportRecord {
  id: string;
  title: string;
  scalarValues: ReadonlyMap<string, string>;
  bodyValues: ReadonlyMap<string, string>;
}

export interface CollectionExportProjection {
  id: string;
  title: string;
  updatedAt: string;
  scalarFields: readonly CollectionExportField[];
  bodyFields: readonly CollectionExportField[];
  records: readonly CollectionExportRecord[];
}

export interface CollectionArchiveFile {
  path: string;
  content: string;
}

function inlineText(value: string | null | undefined, fallback = "Untitled") {
  return (value ?? "").replace(/\s+/g, " ").trim() || fallback;
}

function markdownText(value: string) {
  return value.replace(/\r\n?/g, "\n").trim();
}

function markdownSection(name: string, content: string, level = 3) {
  const body = markdownText(content);
  return `${"#".repeat(level)} ${inlineText(name)}${body ? `\n\n${body}` : ""}`;
}

function recordMarkdown(
  projection: CollectionExportProjection,
  record: CollectionExportRecord,
) {
  const properties = projection.scalarFields.map(
    (field) =>
      `- **${inlineText(field.name)}:** ${record.scalarValues.get(field.id) ?? ""}`,
  );
  const bodies = projection.bodyFields.map((field) =>
    markdownSection(field.name, record.bodyValues.get(field.id) ?? ""),
  );
  return [
    `## ${inlineText(record.title)}`,
    ...(properties.length ? [properties.join("\n")] : []),
    ...bodies,
  ].join("\n\n");
}

/** Render an already-authorized, ordered collection projection as RFC 4180 CSV. */
export function renderCollectionCsv(projection: CollectionExportProjection) {
  const fields = [...projection.scalarFields, ...projection.bodyFields];
  const rows = projection.records.map((record) => [
    record.title,
    ...projection.scalarFields.map(
      (field) => record.scalarValues.get(field.id) ?? "",
    ),
    ...projection.bodyFields.map(
      (field) => record.bodyValues.get(field.id) ?? "",
    ),
  ]);
  return [["Title", ...fields.map((field) => field.name)], ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")
    .concat("\r\n");
}

function yamlString(value: string) {
  return JSON.stringify(value.replace(/\r\n?/g, "\n"));
}

function archiveRecordPath(index: number, record: CollectionExportRecord) {
  const slug = inlineText(record.title)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const stableId = record.id
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `records/${String(index + 1).padStart(4, "0")}-${slug || "untitled"}-${stableId || "record"}.md`;
}

/**
 * Produce the deterministic file model consumed by the browser ZIP encoder.
 * Keeping archive encoding outside this renderer avoids a server-bundle dependency.
 */
export function renderCollectionMarkdownArchive(
  projection: CollectionExportProjection,
): CollectionArchiveFile[] {
  const recordFiles = projection.records.map((record, index) => {
    const path = archiveRecordPath(index, record);
    const propertyLines = projection.scalarFields.map(
      (field) =>
        `  ${yamlString(field.id)}: { name: ${yamlString(field.name)}, value: ${yamlString(record.scalarValues.get(field.id) ?? "")} }`,
    );
    const frontmatter = [
      "---",
      `id: ${yamlString(record.id)}`,
      `title: ${yamlString(record.title)}`,
      ...(propertyLines.length
        ? ["properties:", ...propertyLines]
        : ["properties: {}"]),
      "---",
    ].join("\n");
    const bodies = projection.bodyFields.map((field) =>
      markdownSection(field.name, record.bodyValues.get(field.id) ?? "", 2),
    );
    return {
      path,
      content: `${frontmatter}\n\n# ${inlineText(record.title)}${bodies.length ? `\n\n${bodies.join("\n\n")}` : ""}\n`,
    };
  });
  const indexBody = recordFiles.length
    ? recordFiles
        .map(
          (file, index) =>
            `- [${inlineText(projection.records[index]?.title)}](${file.path})`,
        )
        .join("\n")
    : "_No accessible items._";
  return [
    {
      path: "index.md",
      content: `# ${inlineText(projection.title)}\n\n${indexBody}\n`,
    },
    ...recordFiles,
  ];
}

export function renderCollectionHtml(
  projection: CollectionExportProjection,
  format: "html" | "pdf",
) {
  const content = projection.records.length
    ? projection.records
        .map((record) => recordMarkdown(projection, record))
        .join("\n\n")
    : "_No accessible items._";
  return buildDocumentExport({
    id: projection.id,
    title: projection.title,
    content,
    updatedAt: projection.updatedAt,
    format,
  });
}
