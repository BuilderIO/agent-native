#!/usr/bin/env node
/**
 * Word ceilings for standing instruction docs — the ones loaded into context
 * every session, where a rule nobody reads costs the same as one they do.
 *
 * Ceilings freeze current size; they never grant room to grow. When one goes
 * red the order is relocate (move the fact to its one home), condense, then —
 * only if the words genuinely need the space — raise the ceiling in the same
 * diff so a reviewer sees the trade. Lower a ceiling only when the doc still
 * has 5% headroom under it.
 */
import { readFileSync } from "node:fs";

/** Repo-relative path -> max `wc -w` words. See the header before raising one. */
const BUDGETS = {
  "CLAUDE.md": 3430,
  ".agents/skills/visual-recap/SKILL.md": 5140,
  ".agents/skills/visual-plan/SKILL.md": 4740,
  ".agents/skills/review-latest-feedback/SKILL.md": 4440,
  ".agents/skills/external-agents/SKILL.md": 4030,
  ".agents/skills/turn-into-app/SKILL.md": 3780,
  ".agents/skills/extensions/SKILL.md": 3680,
  ".agents/skills/address-feedback-with-replies/SKILL.md": 3670,
  ".agents/skills/visual-edit/SKILL.md": 3550,
};

const listOnly = process.argv.includes("--list");
const failures = [];
const rows = [];

for (const [path, ceiling] of Object.entries(BUDGETS)) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    // A budgeted doc that cannot be read is never "0 words, passing": either it
    // was renamed without updating BUDGETS, or the checkout is broken. Both are
    // a failure to inspect, not a clean result.
    console.error(`guard:doc-budgets: cannot read ${path} — ${error.message}`);
    console.error(
      "Renamed or deleted? Update BUDGETS in this file in the same change.",
    );
    process.exit(2);
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  const over = words > ceiling;
  rows.push(
    `${over ? "OVER" : "ok  "}  ${String(words).padStart(5)} / ${String(ceiling).padEnd(5)}  ${path}`,
  );
  if (over) {
    failures.push(
      `${path}: ${words} words exceeds its ${ceiling}-word ceiling by ${words - ceiling}`,
    );
  }
}

if (listOnly) {
  console.log(rows.join("\n"));
  process.exit(0);
}

if (failures.length > 0) {
  console.error("guard:doc-budgets failed:\n");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    "\nRelocate the fact to its one home, or condense. Raising a ceiling",
  );
  console.error("requires the justification visible in the same diff.");
  process.exit(1);
}

console.log(
  `guard:doc-budgets: ${Object.keys(BUDGETS).length} standing docs within ceiling.`,
);
