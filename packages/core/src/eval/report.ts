/**
 * Human-readable formatting for an eval run report. Kept separate from the
 * runner so the CLI can print a table while CI consumes the JSON shape.
 */

import type { EvalRunReport } from "./types.js";

function bar(score: number, width = 10): string {
  const filled = Math.round(clamp01(score) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function pct(score: number): string {
  return `${Math.round(clamp01(score) * 100)}%`.padStart(4);
}

/** Render a scored table for the terminal. */
export function formatReport(report: EvalRunReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("  Evals");
  lines.push("  ─────");

  for (const row of report.results) {
    const mark = row.status === "skipped" ? "-" : row.passed ? "✓" : "✗";
    lines.push("");
    if (row.status === "skipped") {
      lines.push(`  ${mark} ${row.eval}  (skipped)`);
      lines.push(`      reason: ${row.skipReason ?? "No reason provided"}`);
      continue;
    } else {
      lines.push(
        `  ${mark} ${row.eval}  (avg ${pct(row.avgScore)}, threshold ${pct(
          row.threshold,
        )})`,
      );
    }
    if (row.error) {
      lines.push(`      ⚠ run error: ${row.error}`);
    }
    for (const s of row.scores) {
      const smark = s.passed ? "✓" : "✗";
      const reason = s.reason ? `  — ${s.reason}` : "";
      lines.push(
        `      ${smark} ${s.scorer.padEnd(20)} ${bar(s.score)} ${pct(
          s.score,
        )}${reason}`,
      );
    }
  }

  lines.push("");
  lines.push("  ─────");
  const skipped = report.skipped ?? 0;
  const executedTotal = report.total - skipped;
  const executedPassed = report.passed - skipped;
  const verdict =
    executedTotal === 0 && skipped > 0
      ? "SKIPPED"
      : report.failed === 0
        ? "PASS"
        : "FAIL";
  lines.push(
    `  ${verdict}: ${executedPassed}/${executedTotal} evals passed` +
      (skipped > 0 ? `, ${skipped} skipped` : "") +
      (report.failed > 0 ? `, ${report.failed} below threshold` : ""),
  );
  lines.push("");
  return lines.join("\n");
}
