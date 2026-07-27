import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parityMatrix } from "./matrix";
import type { ParityRow } from "./matrix.types";

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function cell(value: string | string[] | null | undefined) {
  if (Array.isArray(value))
    return escapeCell(value.length ? value.join(", ") : "-");
  if (value === null || value === undefined || value === "") return "-";
  return escapeCell(value);
}

const headers = [
  "ID",
  "Surface",
  "User-visible action",
  "Status",
  "Actions",
  "UI entrypoints",
  "Durable effect",
  "Exception / gap",
  "Reliability risk",
  "Spine priority",
  "Test coverage",
  "Coverage refs",
  "Eval scenarios",
  "Follow-up",
];

function renderRow(row: ParityRow) {
  return [
    row.id,
    row.surface,
    row.label,
    row.status,
    row.actions.length
      ? row.actions.map((action) => `\`${action}\``).join(", ")
      : "-",
    row.uiEntrypoints.map((entry) => `\`${entry}\``).join(", "),
    row.durableEffect,
    row.exception,
    row.reliabilityRisk === "none" ? "-" : row.reliabilityRisk,
    row.spinePriority,
    row.testCoverage,
    row.coverageRefs?.map((ref) => `\`${ref}\``).join(", "),
    row.evalScenarioIds?.map((id) => `\`${id}\``).join(", "),
    row.followUpPR,
  ].map(cell);
}

function renderTable(rows: string[][]) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const renderCells = (cells: string[]) =>
    `| ${cells.map((value, index) => value.padEnd(widths[index])).join(" | ")} |`;
  return [
    renderCells(headers),
    renderCells(widths.map((width) => "-".repeat(width))),
    ...rows.map(renderCells),
  ];
}

export function renderParityMatrixMarkdown(rows: ParityRow[] = parityMatrix) {
  const sortedRows = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return [
    "# Content Agent/UI Action Parity Matrix",
    "",
    "This generated matrix tracks whether high-value Content UI operations use the same action surface agents can call, or have an explicit exception. Edit `matrix.ts`, then regenerate this file.",
    "",
    ...renderTable(sortedRows.map(renderRow)),
    "",
  ].join("\n");
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);

if (isCli) {
  const markdown = renderParityMatrixMarkdown();
  if (process.argv.includes("--write")) {
    writeFileSync(new URL("./matrix.md", import.meta.url), markdown);
  } else {
    process.stdout.write(markdown);
  }
}
