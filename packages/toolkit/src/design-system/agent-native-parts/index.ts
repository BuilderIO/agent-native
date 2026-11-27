import type { PartComponent } from "../parts.js";
import { BUTTON_PARTS } from "./button.js";
import { SETTINGS_NAV_PARTS } from "./settings-nav.js";
import { SETTINGS_REPORT_PARTS } from "./settings-report.js";
import { SETTINGS_ROW_PARTS } from "./settings-rows.js";
import { SETTINGS_SECTION_PARTS } from "./settings-section.js";

let merged: Readonly<Record<string, PartComponent>> | undefined;

/**
 * Every part toolkit draws itself, merged from one file per area. Merged on
 * first use, not at load: area modules import parts.tsx, which imports this
 * file, so whichever module loads first can leave an area's export
 * uninitialized at load time and a constant would silently miss its parts.
 */
export function agentNativeParts(): Readonly<Record<string, PartComponent>> {
  merged ??= {
    ...BUTTON_PARTS,
    ...SETTINGS_NAV_PARTS,
    ...SETTINGS_ROW_PARTS,
    ...SETTINGS_SECTION_PARTS,
    ...SETTINGS_REPORT_PARTS,
  };
  return merged;
}
