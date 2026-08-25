export type PipeTableNormalizationResult =
  | {
      status: "normalized";
      content: string;
      columnCount: number;
      rowCount: number;
    }
  | {
      status: "unsupported";
      reason: string;
    };

export interface MarkdownImportNormalizationResult {
  content: string;
  normalizedPipeTables: number;
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor--
  ) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function splitPipeRow(line: string): string[] | null {
  const value = line.trim();
  const separators: number[] = [];
  let codeFenceLength = 0;

  for (let index = 0; index < value.length; index++) {
    if (value[index] === "`" && !isEscaped(value, index)) {
      let end = index + 1;
      while (value[end] === "`") end++;
      const runLength = end - index;
      if (codeFenceLength === 0) codeFenceLength = runLength;
      else if (runLength === codeFenceLength) codeFenceLength = 0;
      index = end - 1;
      continue;
    }
    if (
      value[index] === "|" &&
      codeFenceLength === 0 &&
      !isEscaped(value, index)
    ) {
      separators.push(index);
    }
  }

  if (separators.length === 0) return null;
  const cells: string[] = [];
  let start = 0;
  for (const separator of separators) {
    cells.push(value.slice(start, separator).trim());
    start = separator + 1;
  }
  cells.push(value.slice(start).trim());
  if (separators[0] === 0) cells.shift();
  if (separators[separators.length - 1] === value.length - 1) cells.pop();
  return cells.length >= 2 ? cells : null;
}

function isDelimiterRow(cells: string[], expectedColumns: number): boolean {
  return (
    cells.length === expectedColumns &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}

function hasUnsafeTableStructure(cells: string[]): boolean {
  return cells.some((cell) =>
    /<\/?(?:table|thead|tbody|tfoot|tr|td|th|colgroup|col)(?:\s|\/?>)/i.test(
      cell,
    ),
  );
}

function renderNfmTable(rows: string[][]): string {
  return [
    '<table header-row="true">',
    ...rows.flatMap((row) => [
      "<tr>",
      ...row.map((cell) => `<td>${cell}</td>`),
      "</tr>",
    ]),
    "</table>",
  ].join("\n");
}

export function normalizeMarkdownPipeTable(
  source: string,
): PipeTableNormalizationResult {
  const lines = source.split(/\r?\n/);
  if (lines.length < 2) {
    return { status: "unsupported", reason: "missing-delimiter-row" };
  }

  const header = splitPipeRow(lines[0]);
  if (!header) {
    return { status: "unsupported", reason: "invalid-header-row" };
  }
  const delimiter = splitPipeRow(lines[1]);
  if (!delimiter || !isDelimiterRow(delimiter, header.length)) {
    return { status: "unsupported", reason: "invalid-delimiter-row" };
  }

  const rows = [header];
  for (const line of lines.slice(2)) {
    const row = splitPipeRow(line);
    if (!row || row.length !== header.length) {
      return { status: "unsupported", reason: "inconsistent-body-row" };
    }
    rows.push(row);
  }
  if (rows.some(hasUnsafeTableStructure)) {
    return { status: "unsupported", reason: "unsafe-cell-structure" };
  }

  return {
    status: "normalized",
    content: renderNfmTable(rows),
    columnCount: header.length,
    rowCount: rows.length,
  };
}

function fenceMarker(
  line: string,
): { marker: "`" | "~"; length: number } | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!match) return null;
  return { marker: match[1][0] as "`" | "~", length: match[1].length };
}

function closesFence(
  line: string,
  activeFence: { marker: "`" | "~"; length: number },
): boolean {
  const escapedMarker = activeFence.marker === "`" ? "\\x60" : "~";
  const markerRun = `${escapedMarker}{${activeFence.length},}`;
  return new RegExp(`^ {0,3}${markerRun}[ \\t]*$`).test(line);
}

function containsUnsupportedBlockSyntax(markdown: string): boolean {
  let activeFence: { marker: "`" | "~"; length: number } | null = null;
  let braceDepth = 0;
  let htmlComment = false;
  return markdown.split(/\r?\n/).some((line) => {
    const marker = fenceMarker(line);
    if (activeFence) {
      if (closesFence(line, activeFence)) activeFence = null;
      return false;
    }
    if (marker) {
      activeFence = marker;
      return false;
    }
    const value = line.trimStart();
    if (
      /^(?:import|export)\s/.test(value) ||
      /<\/?[A-Za-z][\w.-]*(?:\s|\/?>)/.test(line)
    ) {
      return true;
    }
    const commentStart = line.indexOf("<!--");
    if (commentStart !== -1) htmlComment = true;
    if (htmlComment && line.indexOf("-->", Math.max(commentStart, 0)) !== -1) {
      htmlComment = false;
    }
    for (let index = 0; index < line.length; index++) {
      if (isEscaped(line, index)) continue;
      if (line[index] === "{") braceDepth++;
      if (line[index] === "}") braceDepth = Math.max(0, braceDepth - 1);
    }
    return htmlComment || braceDepth > 0;
  });
}

function isMarkdownBlockStarter(line: string): boolean {
  const value = line.trimStart();
  return (
    /^(?:#{1,6}(?:\s|$)|>|(?:[-+*]|\d+[.)])\s)/.test(value) ||
    /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(value) ||
    fenceMarker(line) !== null
  );
}

function isNestedTableCandidate(lines: string[], index: number): boolean {
  if (/^>/.test(lines[index].trimStart())) return true;
  if (!/^ {1,3}\S/.test(lines[index])) return false;
  for (let cursor = index - 1; cursor >= 0 && lines[cursor].trim(); cursor--) {
    if (/^ {0,3}(?:[-+*]|\d+[.)])\s/.test(lines[cursor])) return true;
    if (!/^\s/.test(lines[cursor])) break;
  }
  return false;
}

export function canNormalizeMarkdownPipeTableRegion(
  markdown: string,
  start: number,
  end: number,
): boolean {
  const withoutCrLf = markdown.split("\r\n").join("");
  if (
    (markdown.includes("\r\n") && withoutCrLf.includes("\n")) ||
    containsUnsupportedBlockSyntax(markdown) ||
    start < 0 ||
    end > markdown.length ||
    start >= end ||
    (start > 0 && markdown[start - 1] !== "\n") ||
    (end < markdown.length && markdown[end] !== "\r" && markdown[end] !== "\n")
  ) {
    return false;
  }

  let activeFence: { marker: "`" | "~"; length: number } | null = null;
  for (const line of markdown.slice(0, start).split(/\r?\n/)) {
    if (activeFence) {
      if (closesFence(line, activeFence)) activeFence = null;
      continue;
    }
    activeFence = fenceMarker(line);
  }
  if (activeFence) return false;

  const regionLines = markdown.slice(start, end).split(/\r?\n/);
  if (regionLines.some((line) => /^(?: {4,}|\t|>)/.test(line))) return false;
  const precedingLines = markdown
    .slice(0, start)
    .replace(/\r?\n$/, "")
    .split(/\r?\n/);
  const precedingLine = precedingLines[precedingLines.length - 1];
  if (precedingLine?.trim() && splitPipeRow(precedingLine)) return false;
  const followingLine = markdown
    .slice(end)
    .replace(/^\r?\n/, "")
    .split(/\r?\n/, 1)[0];
  return !followingLine.trim() || splitPipeRow(followingLine) === null;
}

export function normalizeImportedMarkdownStructures(
  markdown: string,
): MarkdownImportNormalizationResult {
  const withoutCrLf = markdown.split("\r\n").join("");
  const hasMixedLineEndings =
    markdown.includes("\r\n") && withoutCrLf.includes("\n");
  if (hasMixedLineEndings || containsUnsupportedBlockSyntax(markdown)) {
    return { content: markdown, normalizedPipeTables: 0 };
  }
  const lineEnding = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let normalizedPipeTables = 0;
  let normalizedTildeFences = false;
  let activeFence: { marker: "`" | "~"; length: number } | null = null;
  const canonicalFenceLength = Math.max(
    3,
    ...Array.from(markdown.matchAll(/`+/g), (match) => match[0].length + 1),
  );

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = fenceMarker(line);
    if (activeFence) {
      const isCloser = closesFence(line, activeFence);
      output.push(
        isCloser && activeFence.marker === "~"
          ? "`".repeat(canonicalFenceLength)
          : line,
      );
      if (isCloser) activeFence = null;
      continue;
    }
    if (marker) {
      activeFence = marker;
      if (marker.marker === "~") normalizedTildeFences = true;
      output.push(
        marker.marker === "~"
          ? `${"`".repeat(canonicalFenceLength)}${line.slice(marker.length)}`
          : line,
      );
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) {
      output.push(line);
      continue;
    }
    if (isNestedTableCandidate(lines, index)) {
      output.push(line);
      continue;
    }

    const header = splitPipeRow(line);
    const delimiter = splitPipeRow(lines[index + 1] ?? "");
    if (!header || !delimiter || !isDelimiterRow(delimiter, header.length)) {
      output.push(line);
      continue;
    }

    const tableLines = [line, lines[index + 1]];
    let cursor = index + 2;
    let malformedCandidate = false;
    while (cursor < lines.length && lines[cursor].trim()) {
      if (
        isNestedTableCandidate(lines, cursor) ||
        isMarkdownBlockStarter(lines[cursor])
      )
        break;
      const row = splitPipeRow(lines[cursor]);
      if (!row || row.length !== header.length) {
        malformedCandidate =
          row !== null || lines[cursor].trim().startsWith("|");
        break;
      }
      tableLines.push(lines[cursor]);
      cursor++;
    }
    if (malformedCandidate) {
      output.push(line);
      continue;
    }
    const normalized = normalizeMarkdownPipeTable(tableLines.join("\n"));
    if (normalized.status !== "normalized") {
      output.push(line);
      continue;
    }

    output.push(normalized.content.split("\n").join(lineEnding));
    normalizedPipeTables++;
    index += tableLines.length - 1;
  }

  if (normalizedPipeTables === 0 && !normalizedTildeFences) {
    return { content: markdown, normalizedPipeTables };
  }
  return { content: output.join(lineEnding), normalizedPipeTables };
}
