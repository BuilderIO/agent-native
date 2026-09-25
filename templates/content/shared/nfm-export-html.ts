import {
  safeParseIconValue,
  type IconColor,
  type IconValue,
} from "@agent-native/core/icons";
import { icons } from "@tabler/icons-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { splitGfmPipeRow } from "./nfm.js";

/**
 * Notion-flavored container blocks rendered to standalone export HTML.
 *
 * Canonical NFM (see `nfm.ts`) stores tables, callouts, toggles, columns, and
 * synced blocks as HTML-ish tag lines rather than as markdown, and it writes no
 * blank separator line between blocks. The exporter's block scanner is
 * line-oriented markdown, so without this module those lines fall through to
 * its paragraph branch and a table reaches the PDF as escaped `<td>` text.
 *
 * Every container tag lives in `CONTAINER_RENDERERS`: teaching the exporter a
 * new Notion container is an entry there, never another branch in the scanner's
 * block loop.
 */

export interface NfmExportRenderers {
  /** Render nested block markdown by recursing into the exporter's scanner. */
  renderBlocks: (markdown: string) => string;
  /** Render one run of inline markdown (links, emphasis, code, math). */
  renderInline: (text: string) => string;
  escapeHtml: (text: string) => string;
}

export interface NfmExportBlockMatch {
  html: string;
  /** Index of the first line after the consumed block. */
  nextIndex: number;
}

// The exported document is a standalone file with no access to the app's theme
// tokens, so it carries literal values - the same ones the rest of the export
// stylesheet in document-export.ts already uses for `pre` and `blockquote`.
const EXPORT_BORDER = "#d4d4d4"; // guard:allow-raw-color - standalone export document, no theme tokens
const EXPORT_RULE = "#e5e5e5"; // guard:allow-raw-color - standalone export document, no theme tokens
const EXPORT_SURFACE = "#f6f6f6"; // guard:allow-raw-color - standalone export document, no theme tokens
const EXPORT_ICON_COLORS: Record<IconColor, string> = {
  gray: "#787774", // guard:allow-raw-color - standalone export has no theme tokens
  brown: "#9f6b53", // guard:allow-raw-color - standalone export has no theme tokens
  orange: "#c76c24", // guard:allow-raw-color - standalone export has no theme tokens
  yellow: "#a78317", // guard:allow-raw-color - standalone export has no theme tokens
  green: "#448361", // guard:allow-raw-color - standalone export has no theme tokens
  blue: "#337ea9", // guard:allow-raw-color - standalone export has no theme tokens
  purple: "#9065b0", // guard:allow-raw-color - standalone export has no theme tokens
  pink: "#b64c7d", // guard:allow-raw-color - standalone export has no theme tokens
  red: "#c4554d", // guard:allow-raw-color - standalone export has no theme tokens
}; // guard:allow-raw-color - standalone export document, no theme tokens

/** Stylesheet rules the exported document needs for NFM container blocks. */
export const NFM_EXPORT_STYLES = `
    .nfm-table-scroll { margin: 18px 0; max-width: 100%; overflow-x: auto; }
    table.nfm-table {
      border-collapse: collapse;
      border-spacing: 0;
      font-size: 0.95em;
      table-layout: auto;
      width: auto;
    }
    table.nfm-table.nfm-table-full { width: 100%; }
    table.nfm-table th, table.nfm-table td {
      border: 1px solid ${EXPORT_BORDER};
      padding: 7px 11px;
      text-align: left;
      vertical-align: top;
    }
    table.nfm-table th { background: ${EXPORT_SURFACE}; font-weight: 600; }
    table.nfm-table td.nfm-align-center, table.nfm-table th.nfm-align-center { text-align: center; }
    table.nfm-table td.nfm-align-right, table.nfm-table th.nfm-align-right { text-align: right; }
    .nfm-callout {
      background: ${EXPORT_SURFACE};
      border: 1px solid ${EXPORT_RULE};
      border-radius: 8px;
      display: flex;
      gap: 10px;
      margin: 18px 0;
      padding: 14px 16px;
    }
    .nfm-callout-icon { flex: 0 0 auto; line-height: 1.5; }
    .nfm-callout-icon svg, .nfm-callout-icon img { display: block; height: 20px; width: 20px; }
    .nfm-callout-body { flex: 1 1 auto; min-width: 0; }
    .nfm-callout-body > :first-child { margin-top: 0; }
    .nfm-callout-body > :last-child { margin-bottom: 0; }
    .nfm-details { margin: 18px 0; }
    .nfm-details > summary { cursor: default; font-weight: 600; }
    .nfm-details-body { margin-left: 1.1rem; }
    .nfm-columns { display: flex; gap: 24px; margin: 18px 0; }
    .nfm-column { flex: 1 1 0; min-width: 0; }
    .nfm-column > :first-child { margin-top: 0; }
    .nfm-synced { margin: 18px 0; }`;

/** Rules that belong inside the export stylesheet's `@media print` block. */
export const NFM_EXPORT_PRINT_STYLES = `
      table.nfm-table { break-inside: auto; }
      table.nfm-table thead { display: table-header-group; }
      table.nfm-table tr { break-inside: avoid; }
      .nfm-table-scroll { overflow-x: visible; }
      .nfm-callout, .nfm-columns { break-inside: avoid; }
      .nfm-details > summary { list-style: none; }`;

// ── Attribute helpers (mirroring nfm.ts's HTML-ish tag grammar) ──────

const OPEN_TAG_PATTERN = /^<([a-z][a-z0-9_-]*)((?:\s[^>]*)?)>$/;

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseTagAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][\w:-]*)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw))) attrs[match[1]] = unescapeAttr(match[2]);
  return attrs;
}

/**
 * Strip the one extra level of indentation NFM gives a container's children so
 * the nested markdown scanner sees them at column zero. Canonical NFM indents
 * with TABs; space-indented input from hand-authored markdown is tolerated.
 */
function dedentChildren(lines: string[]): string {
  return lines
    .map((line) =>
      line.startsWith("\t") ? line.slice(1) : line.replace(/^ {1,4}/, ""),
    )
    .join("\n");
}

function splitCellLines(source: string): string[] {
  return source.split(/<br\s*\/?>/i);
}

function renderCellContent(
  source: string,
  renderers: NfmExportRenderers,
): string {
  return splitCellLines(source)
    .map((segment) => renderers.renderInline(segment))
    .join("<br />");
}

// ── Block detection ─────────────────────────────────────────────────

type Alignment = "left" | "center" | "right" | null;

interface ContainerDescriptor {
  kind: "container";
  tag: string;
  attrsRaw: string;
  inner: string[];
  nextIndex: number;
}

interface PipeTableDescriptor {
  kind: "pipe-table";
  header: string[];
  alignments: Alignment[];
  rows: string[][];
  nextIndex: number;
}

type BlockDescriptor = ContainerDescriptor | PipeTableDescriptor;

/**
 * Locate the close tag that matches the container opened at `start`, counting
 * nested opens of the same tag. Returns null for an unterminated container so
 * the caller can leave it to the scanner's paragraph handling instead of
 * swallowing the rest of the document — the same degradation `nfm.ts` applies.
 */
function findContainerClose(
  lines: string[],
  start: number,
  tag: string,
): number | null {
  const closeTag = `</${tag}>`;
  let depth = 0;
  let fenceLength = 0;

  for (let index = start; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    const fence = trimmed.match(/^(`{3,})(.*)$/);
    if (fenceLength > 0) {
      if (fence && !fence[2].trim() && fence[1].length >= fenceLength) {
        fenceLength = 0;
      }
      continue;
    }
    if (fence) {
      fenceLength = fence[1].length;
      continue;
    }
    if (trimmed === closeTag) {
      depth--;
      if (depth === 0) return index;
      continue;
    }
    if (trimmed.match(OPEN_TAG_PATTERN)?.[1] === tag) depth++;
  }

  return null;
}

function splitPipeRow(line: string): string[] | null {
  return (
    splitGfmPipeRow(line)?.map((cell) => cell.replace(/\\\|/g, "|")) ?? null
  );
}

/**
 * Read a pipe table's delimiter row. Returns null when any cell is not a
 * `---` / `:--` / `--:` / `:-:` run, which is what separates a real GFM table
 * from a paragraph that merely contains pipes.
 */
function parseAlignmentRow(cells: string[]): Alignment[] | null {
  const alignments: Alignment[] = [];
  for (const cell of cells) {
    const match = cell.match(/^(:?)-{3,}(:?)$/);
    if (!match) return null;
    if (match[1] && match[2]) alignments.push("center");
    else if (match[2]) alignments.push("right");
    else if (match[1]) alignments.push("left");
    else alignments.push(null);
  }
  return alignments;
}

function detectPipeTable(
  lines: string[],
  index: number,
): PipeTableDescriptor | null {
  const header = splitPipeRow(lines[index]);
  if (!header || header.length === 0) return null;

  const delimiterCells =
    index + 1 < lines.length ? splitPipeRow(lines[index + 1]) : null;
  if (!delimiterCells || delimiterCells.length !== header.length) return null;

  const alignments = parseAlignmentRow(delimiterCells);
  if (!alignments) return null;

  const rows: string[][] = [];
  let cursor = index + 2;
  while (cursor < lines.length) {
    if (/^#{1,6}(?:\s|$)/.test(lines[cursor].trim())) break;
    const row = splitPipeRow(lines[cursor]);
    if (!row) break;
    rows.push(row);
    cursor++;
  }

  return { kind: "pipe-table", header, alignments, rows, nextIndex: cursor };
}

function detectContainer(
  lines: string[],
  index: number,
): ContainerDescriptor | null {
  const openTag = lines[index].trim().match(OPEN_TAG_PATTERN);
  // hasOwn, not `in`: a tag named "constructor" or "toString" would otherwise
  // resolve to an inherited Object member and be called as a renderer.
  if (
    !openTag ||
    !Object.prototype.hasOwnProperty.call(CONTAINER_RENDERERS, openTag[1])
  )
    return null;

  const close = findContainerClose(lines, index, openTag[1]);
  if (close === null) return null;

  return {
    kind: "container",
    tag: openTag[1],
    attrsRaw: openTag[2],
    inner: lines.slice(index + 1, close),
    nextIndex: close + 1,
  };
}

function detectBlock(lines: string[], index: number): BlockDescriptor | null {
  return detectPipeTable(lines, index) ?? detectContainer(lines, index);
}

// ── Container renderers ─────────────────────────────────────────────

interface ContainerInput {
  attrs: Record<string, string>;
  inner: string[];
  renderers: NfmExportRenderers;
}

type ContainerRenderer = (input: ContainerInput) => string;

interface ParsedCell {
  header: boolean;
  source: string;
  align: "left" | "center" | "right" | null;
}

interface ParsedRow {
  cells: ParsedCell[];
}

function parseTableRows(
  inner: string[],
  headerRow: boolean,
  headerColumn: boolean,
): { columns: Array<{ width?: string }>; rows: ParsedRow[] } {
  const columns: Array<{ width?: string }> = [];
  const rows: ParsedRow[] = [];

  for (let index = 0; index < inner.length; index++) {
    const line = inner[index].trim();

    const col = line.match(/^<col((?:\s[^>]*)?)\s*\/?>$/);
    if (col) {
      const attrs = parseTagAttrs(col[1]);
      columns.push({ width: attrs.width });
      continue;
    }

    const rowOpen = line.match(/^<tr((?:\s[^>]*)?)>$/);
    if (!rowOpen) continue;

    const cells: ParsedCell[] = [];
    for (index++; index < inner.length; index++) {
      const cellLine = inner[index].trim();
      if (cellLine === "</tr>") break;
      const cell = cellLine.match(
        /^<(t[dh])((?:\s[^>]*)?)>([\s\S]*)<\/t[dh]>$/,
      );
      if (!cell) continue;
      cells.push({
        header:
          cell[1] === "th" ||
          (headerRow && rows.length === 0) ||
          (headerColumn && cells.length === 0),
        source: cell[3],
        align: (() => {
          const value = parseTagAttrs(cell[2]).align;
          return value === "left" || value === "center" || value === "right"
            ? value
            : null;
        })(),
      });
    }

    rows.push({ cells });
  }

  return { columns, rows };
}

function renderTableRow(
  row: ParsedRow,
  renderers: NfmExportRenderers,
  headerColumn: boolean,
): string {
  const cells = row.cells
    .map((cell, position) => {
      const tag = cell.header ? "th" : "td";
      const scope =
        cell.header && headerColumn && position === 0 ? ' scope="row"' : "";
      const alignment =
        cell.align && cell.align !== "left"
          ? ` class="nfm-align-${cell.align}"`
          : "";
      return `<${tag}${scope}${alignment}>${renderCellContent(
        cell.source,
        renderers,
      )}</${tag}>`;
    })
    .join("");

  return `<tr>${cells}</tr>`;
}

const renderTableContainer: ContainerRenderer = ({
  attrs,
  inner,
  renderers,
}) => {
  const headerRow = attrs["header-row"] === "true";
  const headerColumn = attrs["header-column"] === "true";
  const fitPageWidth = attrs["fit-page-width"] === "true";
  const { columns, rows } = parseTableRows(inner, headerRow, headerColumn);

  const colgroup = columns.some((column) => column.width)
    ? `<colgroup>${columns
        .map((column) => {
          const width = column.width?.trim();
          return width && /^\d+(?:\.\d+)?$/.test(width)
            ? `<col style="width: ${width}px" />`
            : "<col />";
        })
        .join("")}</colgroup>`
    : "";

  const headRows = headerRow && rows.length > 0 ? rows.slice(0, 1) : [];
  const bodyRows = headerRow && rows.length > 0 ? rows.slice(1) : rows;

  const thead = headRows.length
    ? `<thead>${headRows
        .map((row) => renderTableRow(row, renderers, headerColumn))
        .join("")}</thead>`
    : "";
  const tbody = bodyRows.length
    ? `<tbody>${bodyRows
        .map((row) => renderTableRow(row, renderers, headerColumn))
        .join("")}</tbody>`
    : "";

  const tableClass = `nfm-table${fitPageWidth ? " nfm-table-full" : ""}`;
  return `<div class="nfm-table-scroll"><table class="${tableClass}">${colgroup}${thead}${tbody}</table></div>`;
};

function renderCalloutIcon(
  value: IconValue | null,
  renderers: NfmExportRenderers,
): string {
  if (!value) return "";
  if (value.kind === "emoji") return renderers.escapeHtml(value.emoji);
  if (value.kind === "image") {
    if (value.authority !== "url" && value.authority !== "notion") return "";
    if (!URL.canParse(value.assetId)) return "";
    const url = new URL(value.assetId);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return `<img src="${renderers.escapeHtml(value.assetId)}" alt="${renderers.escapeHtml(value.alt ?? "")}" />`;
  }

  const name = `${value.name}${value.variant === "filled" ? "-filled" : ""}`;
  const exportName = `Icon${name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}` as keyof typeof icons;
  const component = icons[exportName];
  if (!component) return "";
  const color = value.color ? EXPORT_ICON_COLORS[value.color] : undefined;
  return renderToStaticMarkup(
    createElement(component, {
      size: 20,
      stroke: 2,
      color,
      style: color ? { color } : undefined,
      "aria-hidden": true,
    }),
  );
}

const renderCalloutContainer: ContainerRenderer = ({
  attrs,
  inner,
  renderers,
}) => {
  const parsedIcon = safeParseIconValue(attrs.icon || null);
  const iconMarkup = parsedIcon.success
    ? renderCalloutIcon(parsedIcon.data, renderers)
    : "";
  const icon = iconMarkup
    ? `<span class="nfm-callout-icon">${iconMarkup}</span>`
    : "";
  const body = renderers.renderBlocks(dedentChildren(inner));
  return `<aside class="nfm-callout">${icon}<div class="nfm-callout-body">${body}</div></aside>`;
};

const renderDetailsContainer: ContainerRenderer = ({
  attrs,
  inner,
  renderers,
}) => {
  // NFM keeps `<summary>` on its own line at the container's own indent; every
  // following line is the toggle body, indented one extra level.
  const summaryMatch = inner[0]
    ?.trim()
    .match(/^<summary>([\s\S]*)<\/summary>$/);
  const summarySource = summaryMatch?.[1] ?? "";
  const bodyLines = summaryMatch ? inner.slice(1) : inner;

  const summary = summarySource
    ? renderers.renderInline(summarySource)
    : "Details";

  // Always expanded: a PDF has no disclosure affordance, so a collapsed toggle
  // would drop its body from the exported document.
  return `<details class="nfm-details" open><summary>${summary}</summary><div class="nfm-details-body">${renderers.renderBlocks(
    dedentChildren(bodyLines),
  )}</div></details>`;
};

const renderColumnsContainer: ContainerRenderer = ({ inner, renderers }) =>
  `<div class="nfm-columns">${renderers.renderBlocks(dedentChildren(inner))}</div>`;

const renderColumnContainer: ContainerRenderer = ({ inner, renderers }) =>
  `<div class="nfm-column">${renderers.renderBlocks(dedentChildren(inner))}</div>`;

const renderSyncedContainer: ContainerRenderer = ({ inner, renderers }) =>
  `<div class="nfm-synced">${renderers.renderBlocks(dedentChildren(inner))}</div>`;

const CONTAINER_RENDERERS: Record<string, ContainerRenderer> = {
  table: renderTableContainer,
  callout: renderCalloutContainer,
  details: renderDetailsContainer,
  columns: renderColumnsContainer,
  column: renderColumnContainer,
  synced_block: renderSyncedContainer,
  synced_block_reference: renderSyncedContainer,
  "meeting-notes": renderSyncedContainer,
};

function renderPipeTable(
  descriptor: PipeTableDescriptor,
  renderers: NfmExportRenderers,
): string {
  const columnCount = Math.max(
    descriptor.header.length,
    ...descriptor.rows.map((row) => row.length),
  );
  const alignAttr = (index: number) => {
    const alignment = descriptor.alignments[index];
    return alignment && alignment !== "left"
      ? ` class="nfm-align-${alignment}"`
      : "";
  };

  const head = `<thead><tr>${Array.from(
    { length: columnCount },
    (_, index) =>
      `<th${alignAttr(index)}>${renderers.renderInline(descriptor.header[index] ?? "")}</th>`,
  ).join("")}</tr></thead>`;

  const body = descriptor.rows.length
    ? `<tbody>${descriptor.rows
        .map(
          (row) =>
            `<tr>${Array.from(
              { length: columnCount },
              (_, index) =>
                `<td${alignAttr(index)}>${renderers.renderInline(row[index] ?? "")}</td>`,
            ).join("")}</tr>`,
        )
        .join("")}</tbody>`
    : "";

  return `<div class="nfm-table-scroll"><table class="nfm-table">${head}${body}</table></div>`;
}

/**
 * True when `lines[index]` opens an NFM container or GFM pipe table. The
 * exporter's paragraph accumulator needs this because canonical NFM writes no
 * blank line before a container, so a paragraph would otherwise absorb it.
 */
export function startsNfmExportBlock(lines: string[], index: number): boolean {
  return detectBlock(lines, index) !== null;
}

/** Render the NFM container or pipe table starting at `index`, if there is one. */
export function matchNfmExportBlock(
  lines: string[],
  index: number,
  renderers: NfmExportRenderers,
): NfmExportBlockMatch | null {
  const descriptor = detectBlock(lines, index);
  if (!descriptor) return null;

  if (descriptor.kind === "pipe-table") {
    return {
      html: renderPipeTable(descriptor, renderers),
      nextIndex: descriptor.nextIndex,
    };
  }

  return {
    html: CONTAINER_RENDERERS[descriptor.tag]({
      attrs: parseTagAttrs(descriptor.attrsRaw),
      inner: descriptor.inner,
      renderers,
    }),
    nextIndex: descriptor.nextIndex,
  };
}
