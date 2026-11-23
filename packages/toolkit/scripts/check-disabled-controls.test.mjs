import { spawnSync } from "node:child_process";
// Regression test for the permanently-disabled control check's tag reading.
//
// 2026-11-08: the check reported two content-2 controls that are not disabled.
//   - a Remove filter button whose only "disabled" was inside a comment in its
//     own onClick body ("never left disabled with no way back");
//   - a FilterPill that receives its state through `{...props}`, so whether it
//     is disabled is decided by its callers, not at this site.
// The negative case below is the guard against "fixing" this by going blind.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "check-disabled-controls.mjs",
);

function scan(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "disabled-controls-"));
  try {
    const dir = path.join(root, "templates", "fake-2", "app", "components");
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), body);
    }
    const run = spawnSync(
      process.execPath,
      [script, "--root", root, "--json"],
      {
        encoding: "utf8",
      },
    );
    return JSON.parse(run.stdout || '{"findings":[]}');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("check-disabled-controls", () => {
  it("ignores the word inside a comment in the button's own handler", () => {
    const { findings } = scan({
      "A.tsx": `export const A = () => (
  <Button
    type="button"
    aria-label="Remove filter"
    onClick={() => {
      // Removing the only rule leaves a fresh one, so Apply is never left disabled.
      reset();
    }}
  />
);`,
    });
    expect(findings).toHaveLength(0);
  });

  it("ignores a button whose disabled state comes through a spread", () => {
    const { findings } = scan({
      "B.tsx": `export const Pill = ({ ...props }) => (
  <button type="button" {...props} className={props.disabled ? "off" : "on"} />
);`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still reports a permanently disabled control", () => {
    const { findings } = scan({
      "C.tsx": `export const C = () => (
  <Button type="button" disabled aria-label="Preview">
    <IconEye />
  </Button>
);`,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].snippet).toContain("disabled");
  });

  it("still reports an explicit disabled={true}", () => {
    const { findings } = scan({
      "D.tsx": `export const D = () => (
  <Button type="button" disabled={true} aria-label="Export">
    Save
  </Button>
);`,
    });
    expect(findings).toHaveLength(1);
  });
});
