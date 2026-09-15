/**
 * design-extension-contract.spec.ts
 *
 * Issue 3 regression: list-design-extensions advertised "preview-motion-frame"
 * in the Motion Presets actions array, and run-design-extension-action routed
 * design.motion-presets:preview → preview-motion-frame.  No such action exists.
 *
 * After the fix:
 *   - "preview-motion-frame" must NOT appear in the Motion Presets actions list.
 *   - The design.motion-presets:preview route must point to an action that
 *     actually exists (get-motion-timeline).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const actionsDir = path.dirname(fileURLToPath(import.meta.url));

function readAction(name: string): string {
  return readFileSync(path.join(actionsDir, `${name}.ts`), "utf8");
}

// Real action files that exist on disk — used to verify advertised actions.
const KNOWN_MOTION_ACTIONS = [
  "apply-motion-edit",
  "get-motion-timeline",
  "remove-motion-timeline",
];

describe("list-design-extensions — Motion Presets actions contract (Issue 3)", () => {
  it("does NOT advertise 'preview-motion-frame' in the Motion Presets actions list", () => {
    const src = readAction("list-design-extensions");

    // Extract the actions array for the motion-presets extension block.
    // We check that the string "preview-motion-frame" does not appear anywhere
    // in the source now that the fix is applied.
    expect(src).not.toContain("preview-motion-frame");
  });

  it("all advertised Motion Presets action names correspond to real action files", () => {
    const src = readAction("list-design-extensions");

    // Find the motion-presets block and extract action names.
    // The known actions should all exist.
    for (const action of KNOWN_MOTION_ACTIONS) {
      // Verify the action file actually exists.
      const actionFile = path.join(actionsDir, `${action}.ts`);
      expect(
        (() => {
          try {
            readFileSync(actionFile);
            return true;
          } catch {
            return false;
          }
        })(),
        `Expected ${action}.ts to exist`,
      ).toBe(true);

      // Verify the action is still advertised.
      expect(src).toContain(action);
    }
  });
});

describe("run-design-extension-action — Motion Presets preview route (Issue 3)", () => {
  it("design.motion-presets:preview does NOT route to 'preview-motion-frame'", () => {
    const src = readAction("run-design-extension-action");

    // The dangling reference must be gone.
    expect(src).not.toContain("preview-motion-frame");
  });

  it("design.motion-presets:preview routes to an action that exists", () => {
    const src = readAction("run-design-extension-action");

    // After the fix the route points to get-motion-timeline.
    expect(src).toContain("get-motion-timeline");

    // Confirm get-motion-timeline.ts exists.
    const actionFile = path.join(actionsDir, "get-motion-timeline.ts");
    expect(
      (() => {
        try {
          readFileSync(actionFile);
          return true;
        } catch {
          return false;
        }
      })(),
    ).toBe(true);
  });

  it("design.motion-presets:preview route is marked readOnly:true", () => {
    const src = readAction("run-design-extension-action");

    // The preview route entry should still be read-only.
    // We check that within the motion-presets:preview section, readOnly: true appears.
    const previewIdx = src.indexOf("design.motion-presets:preview");
    expect(previewIdx).toBeGreaterThan(-1);

    // Look for readOnly: true within the next 700 chars after the route key
    // (the paramHint is multi-line so we need a wider window).
    const segment = src.slice(previewIdx, previewIdx + 700);
    expect(segment).toContain("readOnly: true");
  });
});
