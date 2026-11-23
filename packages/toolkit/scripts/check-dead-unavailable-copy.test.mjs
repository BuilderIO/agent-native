import { spawnSync } from "node:child_process";
// Regression test for the dead not-available copy check's reference scope.
//
// 2026-11-08: the check reported 14 unused "not available / coming soon" strings
// across four templates. Ten of them were live copy on shared package surfaces
// the templates render: the scan only read `templates/<app>/app/**`, so a key
// referenced solely from `packages/toolkit` or `packages/dispatch` looked dead.
// The scope now includes `packages/<pkg>/src`, while catalog and locale-data
// files are excluded so a key's own definition can never mask real dead copy.
// The negative cases below are the guard against "fixing" this by going blind.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "check-dead-unavailable-copy.mjs",
);

const CATALOG = `export default {
  workspace: {
    previewUnavailable: "Preview unavailable",
  },
};\n`;

function scan({ catalog = CATALOG, files = {} }) {
  const root = mkdtempSync(path.join(os.tmpdir(), "dead-copy-"));
  try {
    const catalogDir = path.join(root, "templates", "fake-2", "app", "i18n");
    mkdirSync(catalogDir, { recursive: true });
    writeFileSync(path.join(catalogDir, "en-US.ts"), catalog);
    mkdirSync(path.join(root, "templates", "fake-2", "app", "components"), {
      recursive: true,
    });
    for (const [name, body] of Object.entries(files)) {
      const full = path.join(root, name);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, body);
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

describe("check-dead-unavailable-copy", () => {
  it("counts a key referenced only from a shared package surface", () => {
    const { findings } = scan({
      files: {
        "packages/toolkit/src/app/observability/Preview.tsx": `export const P = () => <p>{t("observability.previewUnavailable")}</p>;\n`,
      },
    });
    expect(findings).toHaveLength(0);
  });

  it("still reports a key no browser code references", () => {
    const { findings } = scan({
      files: {
        "templates/fake-2/app/components/Other.tsx": `export const O = () => <p>{t("workspace.somethingElse")}</p>;\n`,
      },
    });
    expect(findings.map((f) => f.key)).toEqual(["previewUnavailable"]);
  });

  it("does not let a package locale catalog mask dead copy", () => {
    const { findings } = scan({
      files: {
        "packages/toolkit/src/i18n/en-US.ts": `export default { workspace: { previewUnavailable: "Preview unavailable" } };\n`,
      },
    });
    expect(findings.map((f) => f.key)).toEqual(["previewUnavailable"]);
  });
});
