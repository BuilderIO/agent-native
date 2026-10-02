// Builds dist/index.html from source.html: inlines the Tabler icons, the Settings
// data, and ../requirements.json in the shape the Spec drawer reads.
// Run: node docs/plans/2026-10-01-design-editor-shell/prototype/build.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Status = "exists" | "new" | "question" | "decided" | "in-pr" | "shipped";

interface Requirement {
  id: string;
  status: Status;
  text: string;
}

interface Area {
  area: string;
  prefix: string;
  steps: number[];
  items: Requirement[];
}

// The drawer shows no tag for "exists": those items describe today's code.
const DRAWER_TAG: Record<Status, string | null> = {
  exists: null,
  new: "new",
  question: "q",
  decided: "decided",
  "in-pr": "in PR",
  shipped: "shipped",
};

const LOGO =
  '<svg width="24" height="14" viewBox="0 0 24 14" aria-hidden="true"><path d="M5.1692 13.9511H0L3.17598 8.37071L7.93853 0L12.735 8.37071H8.34518L5.1692 13.9511Z" fill="currentColor"/><path d="M18.8307 0H24L16.0615 13.9513H10.8923L18.8307 0Z" fill="currentColor"/></svg>';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, path), "utf8");

const { areas } = JSON.parse(read("../requirements.json")) as {
  areas: Area[];
};

const drawer = areas.map((area) => ({
  h: area.area,
  items: area.items.map((item) => {
    if (!(item.status in DRAWER_TAG)) {
      throw new Error(`${item.id}: unknown status "${item.status}"`);
    }
    const tag = DRAWER_TAG[item.status];
    return { id: item.id, t: item.text, ...(tag ? { tag } : {}) };
  }),
}));

const html = read("source.html")
  .replace("__LOGO__", LOGO)
  .replace("__ICONS__", read("icons.json"))
  .replace("__REQUIREMENTS__", JSON.stringify(drawer))
  .replace("__SETTINGS__", read("settings.json"))
  .replace(
    /const LOGO_SMALL = `.*?`;/,
    `const LOGO_SMALL = \`${LOGO.replace('width="24" height="14"', 'width="20" height="12"')}\`;`,
  );

const leftover = html.match(/__[A-Z]+__/);
if (leftover) throw new Error(`Unfilled placeholder ${leftover[0]}`);

mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist/index.html"), html);
const count = areas.reduce((n, area) => n + area.items.length, 0);
console.log(`Built dist/index.html with ${count} requirements.`);
