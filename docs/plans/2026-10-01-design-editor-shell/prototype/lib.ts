// Shared by build.ts and check-refs.ts: loads ../requirements.json, validates it,
// and renders it for the Spec drawer and for requirements.md.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const STATUSES = [
  "context",
  "proposed",
  "question",
  "decided",
  "in-pr",
  "shipped",
] as const;
export type Status = (typeof STATUSES)[number];

export interface Requirement {
  id: string;
  status: Status;
  today?: string;
  change?: string;
  refs?: string[];
  prototype?: string;
}

export interface Area {
  area: string;
  prefix: string;
  steps: number[];
  items: Requirement[];
}

export const planDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadRequirements(): Area[] {
  const { areas } = JSON.parse(
    readFileSync(join(planDir, "requirements.json"), "utf8"),
  ) as { areas: Area[] };
  const seen = new Set<string>();
  for (const area of areas) {
    for (const item of area.items) {
      if (seen.has(item.id)) throw new Error(`Duplicate id ${item.id}`);
      seen.add(item.id);
      if (!STATUSES.includes(item.status)) {
        throw new Error(`${item.id}: unknown status "${item.status}"`);
      }
      // A context item describes the code; every other status is about a change.
      if (item.status === "context" ? !item.today : !item.change) {
        throw new Error(
          `${item.id}: a ${item.status} item needs ${item.status === "context" ? "today" : "change"}`,
        );
      }
    }
  }
  return areas;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const codeToHtml = (text: string) =>
  escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>");

const LABEL: Record<Status, string | null> = {
  context: null,
  proposed: "Proposed",
  question: "Question",
  decided: "Decided",
  "in-pr": "In PR",
  shipped: "Shipped",
};

// The Spec drawer's shape: one group per area, each item with its id, label, and HTML.
export function drawerData(areas: Area[]) {
  return areas.map((area) => ({
    h: area.area,
    items: area.items.map((item) => ({
      id: item.id,
      status: item.status,
      label: LABEL[item.status],
      t: [
        item.today ? `<span class="today">Today: ${codeToHtml(item.today)}</span>` : "",
        item.change ? `<span class="change">${codeToHtml(item.change)}</span>` : "",
        item.prototype ? `<span class="proto">Prototype: ${codeToHtml(item.prototype)}</span>` : "",
      ].join(""),
    })),
  }));
}

export function requirementsMarkdown(areas: Area[]): string {
  const lines = [
    "<!-- Generated from requirements.json by prototype/build.ts. Edit the JSON, then rebuild. -->",
    "",
    "# Requirements",
    "",
    "Statuses: `context` describes the code with nothing to build; `proposed`, `question`, `decided`, `in-pr`, and `shipped` track a change. Steps refer to the roadmap in README.md.",
  ];
  for (const area of areas) {
    lines.push("", `## ${area.area} (${area.prefix}, step ${area.steps.join(", ")})`, "");
    for (const item of area.items) {
      lines.push(`- **${item.id}** · ${item.status}`);
      if (item.today) lines.push(`  - Today: ${item.today}`);
      if (item.change) lines.push(`  - Change: ${item.change}`);
      if (item.prototype) lines.push(`  - Prototype: ${item.prototype}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
