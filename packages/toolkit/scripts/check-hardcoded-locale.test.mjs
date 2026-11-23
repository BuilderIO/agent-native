import { spawnSync } from "node:child_process";
// Regression test for the hardcoded-locale check's comment handling.
//
// 2026-11-08: the check reported the custom-emoji settings screen for a
// `toLocaleString()` call that only appears in an explanatory comment about the
// source's own formatting. Comments are not code, so they are stripped before
// matching; the negative pairs below keep the check from going blind.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "check-hardcoded-locale.mjs",
);

function scan(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "hardcoded-locale-"));
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

describe("check-hardcoded-locale", () => {
  it("ignores a formatting call that only appears in a comment", () => {
    const { findings } = scan({
      "A.tsx": `export const A = () => {
  // The source formats the limit with \`l.toLocaleString()\`, so 5000 reads 5,000.
  return <span>{formatNumber(limit)}</span>;
};`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still reports a pinned locale and a bare runtime call", () => {
    const { findings } = scan({
      "B.tsx": `export const B = () => {
  const a = new Intl.DateTimeFormat("en-US", { hour: "numeric" });
  const b = new Date().toLocaleString();
  return [a, b];
};`,
    });
    expect(findings).toHaveLength(2);
  });

  it("accepts an explicit locale variable", () => {
    const { findings } = scan({
      "C.tsx": `export const C = ({ locale }) => (
  new Intl.DateTimeFormat(locale, { hour: "numeric" })
);`,
    });
    expect(findings).toHaveLength(0);
  });
});

// 2026-11-09 (ARM C sibling sweep): the class also lives in the shared Toolkit components every
// template mounts, so the detector gained an opt-in --shared scan. The default run must keep
// reporting only templates (its existing contract); --shared must surface a shared site.
describe("check-hardcoded-locale --shared", () => {
  function scanBoth() {
    const root = mkdtempSync(
      path.join(os.tmpdir(), "hardcoded-locale-shared-"),
    );
    try {
      const tpl = path.join(root, "templates", "fake-2", "app");
      const shared = path.join(root, "packages", "toolkit", "src", "ui");
      mkdirSync(tpl, { recursive: true });
      mkdirSync(shared, { recursive: true });
      writeFileSync(
        path.join(tpl, "T.tsx"),
        "export const T = () => new Date().toLocaleString();\n",
      );
      writeFileSync(
        path.join(shared, "S.tsx"),
        "export const S = () => new Date().toLocaleString();\n",
      );
      const tail = spawnSync(
        process.execPath,
        [script, "--root", root, "--json", "--shared"],
        { encoding: "utf8" },
      );
      const head = spawnSync(
        process.execPath,
        [script, "--root", root, "--json"],
        { encoding: "utf8" },
      );
      return {
        shared: JSON.parse(tail.stdout || '{"findings":[]}').findings,
        plain: JSON.parse(head.stdout || '{"findings":[]}').findings,
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it("reports a shared toolkit site only when --shared is passed", () => {
    const { shared, plain } = scanBoth();
    expect(plain.map((f) => f.app)).toEqual(["fake-2"]);
    expect(shared.map((f) => f.app).sort()).toEqual(["@shared", "fake-2"]);
  });
});

// 2026-11-13 (LOCALE sibling sweep): `toLocaleDateString(undefined, { … })` is the same runtime-locale
// fall back as a bare call, and the check missed it, so sixteen such sites survived a sweep that
// reported the apps clean.
describe("check-hardcoded-locale undefined toLocale argument", () => {
  it("reports toLocale*String(undefined, …) as a runtime-locale format", () => {
    const { findings } = scan({
      "D.tsx": `export const D = ({ at }) => [
  at.toLocaleDateString(undefined, { month: "long" }),
  at.toLocaleTimeString(undefined, { hour: "numeric" }),
  at.toLocaleString(undefined, { dateStyle: "medium" }),
];`,
    });
    expect(findings.map((f) => f.kind)).toEqual([
      "runtime-locale",
      "runtime-locale",
      "runtime-locale",
    ]);
  });
});
