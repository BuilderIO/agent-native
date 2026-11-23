import { spawnSync } from "node:child_process";
// Regression test for the hand-built LIKE pattern check.
//
// 2026-11-13: one app built six LIKE patterns by hand. Five copied the shared escaping rule, one
// escaped `%` and `_` but not a backslash, so a search containing `\` built an invalid pattern. The
// check has to tell a real pattern from prose about one, and from a caller that receives a pattern it
// did not build.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "check-raw-like-pattern.mjs",
);

function scan(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "raw-like-"));
  try {
    const dir = path.join(root, "templates", "fake-2", "actions");
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

describe("check-raw-like-pattern", () => {
  it("finds a hand-built contains pattern", () => {
    const { findings } = scan({
      "list-things.ts": `
        const needle = \`%\${query.replace(/[\\\\%_]/g, "\\\\$&")}%\`;
        const rows = await db.select().from(t).where(ilike(t.name, needle));
      `,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].hits[0].kind).toBe("hand-built-pattern");
  });

  it("finds a local copy of the escaping rule next to a wildcard", () => {
    const { findings } = scan({
      "search-things.ts": `
        const escape = (value: string) => \`%\${value.replace(/[%_]/g, (m) => \`\\\\\${m}\`)}%\`;
        await db.select().from(t).where(ilike(t.name, escape(query)));
      `,
    });
    expect(findings).toHaveLength(1);
    // The line is both a hand-built pattern and a local escaper; either label is a correct report.
    expect(["hand-built-pattern", "local-escaper"]).toContain(
      findings[0].hits[0].kind,
    );
  });

  it("accepts a caller that uses the shared helper", () => {
    const { findings } = scan({
      "list-things.ts": `
        import { likeContainsPattern } from "@agent-native/core/search-utils";
        const rows = await db.select().from(t).where(ilike(t.name, likeContainsPattern(query)));
      `,
    });
    expect(findings).toEqual([]);
  });

  it("holds out prose and non-LIKE percentages", () => {
    const { findings } = scan({
      "format.ts": `
        // shoppers get 10% off, and \`%\${x}%\` in this comment is not a pattern
        export const label = (x: number) => \`%\${x}\`;
        export const share = 100;
      `,
    });
    expect(findings).toEqual([]);
  });
});
