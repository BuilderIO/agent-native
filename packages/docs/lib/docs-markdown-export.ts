import {
  resolveDocBlockType,
  splitDocSegments,
  type DocSegment,
} from "./doc-block-segments";

type BlockSegment = Extract<DocSegment, { kind: "block" }>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function boolText(value: unknown, label: string): string | undefined {
  return value === true ? label : undefined;
}

function escapeTableCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function fenced(language: string, code: unknown): string {
  return [`\`\`\`${language}`, String(code ?? "").trimEnd(), "```"].join("\n");
}

function protectInlineJsx(value: string): string {
  return value.replace(
    /<\/?[A-Z][A-Za-z0-9.]*\s*\/?>/g,
    (match, offset, source: string) => {
      const before = source[offset - 1];
      const after = source[offset + match.length];
      return before === "`" && after === "`" ? match : `\`${match}\``;
    },
  );
}

function headingForBlock(segment: BlockSegment, fallback: string): string[] {
  const title =
    segment.source === "mdx" ? segment.title : segment.attrs.title || undefined;
  const summary =
    segment.source === "mdx"
      ? segment.summary
      : segment.attrs.summary || undefined;
  return [
    `### ${protectInlineJsx(title || fallback)}`,
    summary ? protectInlineJsx(summary) : undefined,
  ].filter(Boolean) as string[];
}

function formatCallout(data: Record<string, unknown>): string {
  return asString(data.body) ?? "";
}

function formatChecklist(data: Record<string, unknown>): string {
  return asArray(data.items)
    .map((item) => {
      const row = asRecord(item);
      const checked = row.checked === true ? "x" : " ";
      const label = asString(row.label) ?? "Untitled";
      const note = asString(row.note);
      return note
        ? `- [${checked}] ${label} - ${note}`
        : `- [${checked}] ${label}`;
    })
    .join("\n");
}

function formatFileTree(
  data: Record<string, unknown>,
  includeTitle = true,
): string {
  const title = asString(data.title);
  const rows = asArray(data.entries).map((entry) => {
    const row = asRecord(entry);
    const path = asString(row.path) ?? "unknown";
    const change = asString(row.change);
    const note = asString(row.note);
    const suffix = [change, note].filter(Boolean).join(" - ");
    return suffix ? `- \`${path}\` - ${suffix}` : `- \`${path}\``;
  });
  return [
    includeTitle && title ? `#### ${protectInlineJsx(title)}` : undefined,
    ...rows,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTable(data: Record<string, unknown>): string {
  const columns = asArray(data.columns).map((column) => String(column ?? ""));
  const rows = asArray(data.rows).map((row) => asArray(row));
  if (columns.length === 0) return "";
  return [
    `| ${columns.map(escapeTableCell).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => {
      const cells = columns.map((_, index) => escapeTableCell(row[index]));
      return `| ${cells.join(" | ")} |`;
    }),
  ].join("\n");
}

function formatApiEndpoint(data: Record<string, unknown>): string {
  const method = asString(data.method) ?? "GET";
  const path = asString(data.path) ?? "/";
  const lines = [`#### ${method} ${path}`];
  const details = [
    asString(data.summary),
    asString(data.description),
    asString(data.auth) ? `Auth: ${asString(data.auth)}` : undefined,
    boolText(data.deprecated, "Deprecated"),
    asString(data.change) ? `Change: ${asString(data.change)}` : undefined,
  ].filter(Boolean);
  lines.push(...(details as string[]));

  const params = asArray(data.params);
  if (params.length > 0) {
    lines.push(
      "",
      "| Parameter | Location | Type | Required | Description |",
      "| --- | --- | --- | --- | --- |",
      ...params.map((param) => {
        const row = asRecord(param);
        return `| ${escapeTableCell(row.name)} | ${escapeTableCell(
          row.in,
        )} | ${escapeTableCell(row.type)} | ${
          row.required === true ? "yes" : "no"
        } | ${escapeTableCell(row.description)} |`;
      }),
    );
  }

  const request = asRecord(data.request);
  if (asString(request.example)) {
    lines.push(
      "",
      "Request example:",
      "",
      fenced(
        asString(request.contentType)?.includes("json") ? "json" : "",
        request.example,
      ),
    );
  }

  const responses = asArray(data.responses);
  if (responses.length > 0) {
    lines.push("", "Responses:");
    for (const response of responses) {
      const row = asRecord(response);
      lines.push(
        "",
        `- ${asString(row.status) ?? "status"}${asString(row.description) ? `: ${asString(row.description)}` : ""}`,
      );
      if (asString(row.example)) {
        lines.push("", fenced("json", row.example));
      }
    }
  }

  return lines.join("\n");
}

function formatDataModel(data: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const entity of asArray(data.entities)) {
    const model = asRecord(entity);
    lines.push(
      `#### ${asString(model.name) ?? asString(model.id) ?? "Entity"}`,
    );
    if (asString(model.note)) lines.push(asString(model.note)!);
    lines.push(
      "",
      "| Field | Type | Flags | Notes |",
      "| --- | --- | --- | --- |",
    );
    for (const field of asArray(model.fields)) {
      const row = asRecord(field);
      const flags = [
        boolText(row.pk, "pk"),
        asString(row.fk) ? `fk ${asString(row.fk)}` : undefined,
        boolText(row.nullable, "nullable"),
        asString(row.default) ? `default ${asString(row.default)}` : undefined,
        asString(row.change),
      ].filter(Boolean);
      lines.push(
        `| ${escapeTableCell(row.name)} | ${escapeTableCell(
          row.type,
        )} | ${escapeTableCell(flags.join(", "))} | ${escapeTableCell(
          row.note,
        )} |`,
      );
    }
    lines.push("");
  }

  const relations = asArray(data.relations);
  if (relations.length > 0) {
    lines.push("Relations:");
    for (const relation of relations) {
      const row = asRecord(relation);
      lines.push(
        `- ${asString(row.from) ?? "from"} -> ${
          asString(row.to) ?? "to"
        }${asString(row.kind) ? ` (${asString(row.kind)})` : ""}${
          asString(row.label) ? ` - ${asString(row.label)}` : ""
        }`,
      );
    }
  }
  return lines.join("\n").trim();
}

function formatAnnotatedCode(data: Record<string, unknown>): string {
  const lines = [
    asString(data.filename) ? `#### ${asString(data.filename)}` : undefined,
    fenced(asString(data.language) ?? "", data.code),
  ].filter(Boolean) as string[];
  const annotations = asArray(data.annotations);
  if (annotations.length > 0) {
    lines.push("", "Annotations:");
    for (const annotation of annotations) {
      const row = asRecord(annotation);
      lines.push(
        `- Lines ${asString(row.lines) ?? "?"}: ${
          asString(row.label) ? `${asString(row.label)} - ` : ""
        }${asString(row.note) ?? ""}`,
      );
    }
  }
  return lines.join("\n");
}

function formatDiff(data: Record<string, unknown>): string {
  const language = asString(data.language) ?? "";
  return [
    asString(data.filename) ? `#### ${asString(data.filename)}` : undefined,
    "Before:",
    "",
    fenced(language, data.before),
    "",
    "After:",
    "",
    fenced(language, data.after),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatJson(data: Record<string, unknown>): string {
  return [
    asString(data.title) ? `#### ${asString(data.title)}` : undefined,
    fenced("json", data.json),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatOpenApi(data: Record<string, unknown>): string {
  return [
    asString(data.title) ? `#### ${asString(data.title)}` : undefined,
    fenced("json", data.spec),
  ]
    .filter(Boolean)
    .join("\n");
}

function nestedBlockToMarkdown(block: unknown): string {
  const row = asRecord(block);
  const type = asString(row.type) ?? "block";
  return formatBlockData(type, asRecord(row.data), undefined);
}

function formatTabs(data: Record<string, unknown>): string {
  return asArray(data.tabs)
    .map((tab) => {
      const row = asRecord(tab);
      const blocks = asArray(row.blocks)
        .map(nestedBlockToMarkdown)
        .filter(Boolean)
        .join("\n\n");
      return [`#### ${asString(row.label) ?? "Tab"}`, blocks]
        .filter(Boolean)
        .join("\n\n");
    })
    .join("\n\n");
}

function formatColumns(data: Record<string, unknown>): string {
  return asArray(data.columns)
    .map((column, index) => {
      const row = asRecord(column);
      const blocks = asArray(row.blocks)
        .map(nestedBlockToMarkdown)
        .filter(Boolean)
        .join("\n\n");
      return [`#### ${asString(row.label) ?? `Column ${index + 1}`}`, blocks]
        .filter(Boolean)
        .join("\n\n");
    })
    .join("\n\n");
}

function formatWireframe(data: Record<string, unknown>): string {
  if (asString(data.caption) || asString(data.html)) {
    return [
      asString(data.caption) ? `#### ${asString(data.caption)}` : undefined,
      asString(data.html) ? fenced("html", data.html) : undefined,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return fenced("json", JSON.stringify(data, null, 2));
}

function formatDiagram(data: Record<string, unknown>): string {
  if (asString(data.caption) || asString(data.html) || asString(data.css)) {
    return [
      asString(data.caption)
        ? `#### ${protectInlineJsx(asString(data.caption)!)}`
        : undefined,
      asString(data.html) ? fenced("html", data.html) : undefined,
      asString(data.css) ? fenced("css", data.css) : undefined,
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  return fenced("json", JSON.stringify(data, null, 2));
}

function formatBlockData(
  type: string,
  data: Record<string, unknown>,
  segment: BlockSegment | undefined,
): string {
  const fallback = type
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const prefix = segment ? headingForBlock(segment, fallback) : [];
  const body =
    type === "callout"
      ? formatCallout(data)
      : type === "checklist"
        ? formatChecklist(data)
        : type === "file-tree"
          ? formatFileTree(data, !segment)
          : type === "table"
            ? formatTable(data)
            : type === "api-endpoint"
              ? formatApiEndpoint(data)
              : type === "data-model"
                ? formatDataModel(data)
                : type === "annotated-code"
                  ? formatAnnotatedCode(data)
                  : type === "diff"
                    ? formatDiff(data)
                    : type === "json-explorer"
                      ? formatJson(data)
                      : type === "openapi-spec"
                        ? formatOpenApi(data)
                        : type === "tabs"
                          ? formatTabs(data)
                          : type === "columns"
                            ? formatColumns(data)
                            : type === "wireframe"
                              ? formatWireframe(data)
                              : type === "diagram"
                                ? formatDiagram(data)
                                : fenced("json", JSON.stringify(data, null, 2));

  return [...prefix, body].filter(Boolean).join("\n\n");
}

function fenceSegmentToMarkdown(
  segment: Extract<BlockSegment, { source: "fence" }>,
): string {
  const type = resolveDocBlockType(segment.alias);
  if (type === "mermaid") {
    return fenced("mermaid", segment.body);
  }
  if (!type) {
    const attrs = Object.entries(segment.attrs)
      .map(([key, value]) => `${key}="${value.replace(/"/g, '\\"')}"`)
      .join(" ");
    return [
      `\`\`\`${segment.alias}${attrs ? ` ${attrs}` : ""}`,
      segment.body.trimEnd(),
      "```",
    ].join("\n");
  }
  try {
    return formatBlockData(type, asRecord(JSON.parse(segment.body)), segment);
  } catch {
    return [`\`\`\`${segment.alias}`, segment.body.trimEnd(), "```"].join("\n");
  }
}

export function docsBodyToMarkdownMirror(body: string): string {
  return (
    splitDocSegments(body)
      .map((segment) => {
        if (segment.kind === "markdown") return segment.text.trim();
        if (segment.kind === "invalid-block") return segment.body.trim();
        if (segment.source === "fence") return fenceSegmentToMarkdown(segment);
        return formatBlockData(segment.type, asRecord(segment.data), segment);
      })
      .filter(Boolean)
      .join("\n\n")
      .trim() + "\n"
  );
}
