import { spawnSync } from "node:child_process";
// Regression test for the CSS custom-property coverage check.
//
// 2026-11-09 (crm-2 row 169, P1): four rules painted destructive copy with
// `var(--ws-danger, #e5484d)` and six rules set a font size from
// `var(--ws-small-label-size)` with no fallback, while no stylesheet in the app
// declared either name. The danger fallback is a light-theme literal that stays
// that red under the app's dark tokens, and the size rule is invalid at
// computed-value time (the property reverts to its inherited value), so the
// palette's shortcut badges and the workspace glyph rendered at the wrong size.
// The same read found three more unprovided names in the shared editor
// stylesheet.
//
// The negative controls below are the guard against "fixing" this by treating a
// fallback literal as provision, or by ignoring a property that is set at
// runtime by the app's own code.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "check-css-token-coverage.mjs",
);

function run(tree, extraArgs = []) {
  const root = mkdtempSync(path.join(os.tmpdir(), "css-token-coverage-"));
  try {
    for (const [relative, body] of Object.entries(tree)) {
      const file = path.join(root, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, body);
    }
    const result = spawnSync(
      process.execPath,
      [script, "--root", root, "--json", ...extraArgs],
      { encoding: "utf8" },
    );
    return {
      status: result.status,
      report: result.stdout ? JSON.parse(result.stdout) : null,
      stderr: result.stderr,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const APP_CSS = "templates/fake-2/app";

describe("css token coverage", () => {
  it("passes when the app stylesheet declares what it consumes", () => {
    const result = run({
      [`${APP_CSS}/global.css`]:
        ":root { --ws-danger: #ee7a7a; }\n.warning { color: var(--ws-danger); }\n",
    });
    expect(result.report.findings).toEqual([]);
    expect(result.status).toBe(0);
  });

  it("fails on a consumed token no stylesheet declares (mutant re-introduces row 169)", () => {
    const result = run({
      [`${APP_CSS}/global.css`]: ":root { --ws-error: #ee7a7a; }\n",
      [`${APP_CSS}/features/calls/calls.css`]:
        ".call-error { color: var(--ws-danger, #e5484d); }\n",
    });
    expect(result.status).toBe(1);
    expect(result.report.findings.map((f) => f.variable)).toEqual([
      "--ws-danger",
    ]);
    expect(result.report.findings[0].sites).toEqual([
      "templates/fake-2/app/features/calls/calls.css:1",
    ]);
  });

  it("fails a fallback-less consumption (invalid at computed-value time)", () => {
    const result = run({
      [`${APP_CSS}/global.css`]:
        ".palette kbd { font-size: var(--ws-small-label-size); }\n",
    });
    expect(result.status).toBe(1);
    expect(result.report.findings.map((f) => f.variable)).toEqual([
      "--ws-small-label-size",
    ]);
  });

  it("accepts a token the app sets at runtime, by style key or setProperty", () => {
    const result = run({
      [`${APP_CSS}/global.css`]:
        ".banner { background: linear-gradient(var(--ws-home-progress, 0%)); }\n" +
        ".cursor { transform: scale(var(--an-replay-cursor-scale, 1)); }\n",
      [`${APP_CSS}/components/context-banner.tsx`]:
        'export const style = { "--ws-home-progress": "40%" };\n',
      [`${APP_CSS}/components/replay.ts`]:
        'root.style.setProperty("--an-replay-cursor-scale", String(1 / scale));\n',
    });
    expect(result.report.findings).toEqual([]);
    expect(result.status).toBe(0);
  });

  it("scans the shared toolkit only when --shared is passed", () => {
    const tree = {
      [`${APP_CSS}/global.css`]: ":root { --ws-ink: #fff; }\n",
      "packages/toolkit/src/editor.css":
        ".cell { border: 1px solid var(--an-border, #d4d4d4); }\n",
    };
    expect(run(tree).report.findings).toEqual([]);
    const shared = run(tree, ["--shared"]);
    expect(shared.status).toBe(1);
    expect(
      shared.report.findings.map((f) => `${f.scope}:${f.variable}`),
    ).toEqual(["@shared:--an-border"]);
  });
});
