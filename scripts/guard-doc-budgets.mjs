#!/usr/bin/env node
import { readFileSync } from "node:fs";

const BUDGETS = {
  "AGENTS.md": 3430,
  "CLAUDE.md": 3430,
  ".agents/skills/visual-recap/SKILL.md": 5140,
  ".agents/skills/visual-plan/SKILL.md": 4740,
  ".agents/skills/review-latest-feedback/SKILL.md": 4490,
  ".agents/skills/external-agents/SKILL.md": 4060,
  ".agents/skills/turn-into-app/SKILL.md": 3780,
  ".agents/skills/extensions/SKILL.md": 3680,
  ".agents/skills/address-feedback-with-replies/SKILL.md": 3670,
  ".agents/skills/visual-edit/SKILL.md": 4350,
};

const listOnly = process.argv.includes("--list");
const failures = [];
const rows = [];

for (const [path, ceiling] of Object.entries(BUDGETS)) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
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
