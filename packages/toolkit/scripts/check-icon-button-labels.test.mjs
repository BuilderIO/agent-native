import { spawnSync } from "node:child_process";
// Regression test for the icon-button label check's tag reader.
//
// 2026-11-08: the check reported 10 icon-only buttons across five apps, and all ten
// were false positives. Two causes, both in how the tag was extracted:
//   - `[^>]*?` stopped at the `>` inside `onClick={() => …}`, so any `aria-label`
//     written after that attribute never counted;
//   - with `asChild` the label lives on the child element, not on the button.
// The negative case below is the guard against "fixing" this by going blind.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "check-icon-button-labels.mjs",
);

function scan(sources) {
  const root = mkdtempSync(path.join(os.tmpdir(), "icon-labels-"));
  try {
    for (const [name, body] of Object.entries(sources)) {
      const dir = path.join(root, "templates", "fake-2", "app", "components");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, name), body);
    }
    const run = spawnSync(
      process.execPath,
      [script, "--root", root, "--json"],
      { encoding: "utf8" },
    );
    return JSON.parse(run.stdout || '{"findings":[]}');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("check-icon-button-labels", () => {
  it("sees an aria-label that follows an arrow function in the same tag", () => {
    const { findings } = scan({
      "A.tsx": `export const A = () => (
  <Button type="button" size="icon" onClick={() => go()} aria-label="Close">
    <IconX />
  </Button>
);`,
    });
    expect(findings).toHaveLength(0);
  });

  it("accepts a label carried by the asChild child element", () => {
    const { findings } = scan({
      "B.tsx": `export const B = () => (
  <Button asChild size="icon" variant="ghost">
    <a href="/x" aria-label="Open in a new tab"><IconExternalLink /></a>
  </Button>
);`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still reports an icon-only button with no accessible name", () => {
    const { findings } = scan({
      "C.tsx": `export const C = () => (
  <Button type="button" size="icon" onClick={() => go()}>
    <IconX />
  </Button>
);`,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
  });

  it("reads a tag that carries a comment between its attributes", () => {
    const { findings } = scan({
      "D.tsx": `export const D = () => (
  <Button
    type="button"
    size="icon"
    // keeps focus while the picker opens
    onMouseDown={(event) => event.preventDefault()}
    aria-label="Change icon"
  >
    <IconStar />
  </Button>
);`,
    });
    expect(findings).toHaveLength(0);
  });
});
