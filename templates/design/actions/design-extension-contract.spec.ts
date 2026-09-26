
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const actionsDir = path.dirname(fileURLToPath(import.meta.url));

function readAction(name: string): string {
  return readFileSync(path.join(actionsDir, `${name}.ts`), "utf8");
}

const KNOWN_MOTION_ACTIONS = [
  "apply-motion-edit",
  "get-motion-timeline",
  "remove-motion-timeline",
];

describe("list-design-extensions — Motion Presets actions contract (Issue 3)", () => {
  it("does NOT advertise 'preview-motion-frame' in the Motion Presets actions list", () => {
    const src = readAction("list-design-extensions");

    expect(src).not.toContain("preview-motion-frame");
  });

  it("all advertised Motion Presets action names correspond to real action files", () => {
    const src = readAction("list-design-extensions");

    for (const action of KNOWN_MOTION_ACTIONS) {
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

      expect(src).toContain(action);
    }
  });
});

describe("run-design-extension-action — Motion Presets preview route (Issue 3)", () => {
  it("design.motion-presets:preview does NOT route to 'preview-motion-frame'", () => {
    const src = readAction("run-design-extension-action");

    expect(src).not.toContain("preview-motion-frame");
  });

  it("design.motion-presets:preview routes to an action that exists", () => {
    const src = readAction("run-design-extension-action");

    expect(src).toContain("get-motion-timeline");

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

    const previewIdx = src.indexOf("design.motion-presets:preview");
    expect(previewIdx).toBeGreaterThan(-1);

    const segment = src.slice(previewIdx, previewIdx + 700);
    expect(segment).toContain("readOnly: true");
  });
});
