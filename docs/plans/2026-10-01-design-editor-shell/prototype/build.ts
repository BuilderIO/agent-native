// Builds dist/index.html from source.html, inlining the Tabler icons, the Settings
// data, and ../requirements.json for the Spec drawer. Also regenerates
// ../requirements.md, the readable copy of the requirements.
// Run: node docs/plans/2026-10-01-design-editor-shell/prototype/build.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { drawerData, loadRequirements, planDir, requirementsMarkdown } from "./lib.ts";

const LOGO =
  '<svg width="24" height="14" viewBox="0 0 24 14" aria-hidden="true"><path d="M5.1692 13.9511H0L3.17598 8.37071L7.93853 0L12.735 8.37071H8.34518L5.1692 13.9511Z" fill="currentColor"/><path d="M18.8307 0H24L16.0615 13.9513H10.8923L18.8307 0Z" fill="currentColor"/></svg>';

const here = join(planDir, "prototype");
const read = (path: string) => readFileSync(join(here, path), "utf8");
const areas = loadRequirements();

const html = read("source.html")
  .replace("__LOGO__", LOGO)
  .replace("__ICONS__", read("icons.json"))
  .replace("__REQUIREMENTS__", JSON.stringify(drawerData(areas)))
  .replace("__SETTINGS__", read("settings.json"))
  .replace(
    /const LOGO_SMALL = `.*?`;/,
    `const LOGO_SMALL = \`${LOGO.replace('width="24" height="14"', 'width="20" height="12"')}\`;`,
  );

const leftover = html.match(/__[A-Z]+__/);
if (leftover) throw new Error(`Unfilled placeholder ${leftover[0]}`);

mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist/index.html"), html);
writeFileSync(join(planDir, "requirements.md"), requirementsMarkdown(areas));
const count = areas.reduce((n, area) => n + area.items.length, 0);
console.log(`Built dist/index.html and requirements.md from ${count} requirements.`);
