import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { runCodemod } from "./codemod.ts";
import { formatOxfmt, formatReport } from "./index.ts";
import type { CodemodOptions } from "./types.ts";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const REPO = path.resolve(import.meta.dirname, "../..");
fs.mkdirSync(path.join(REPO, ".tmp"), { recursive: true });
const SCRATCH = fs.mkdtempSync(
  path.join(REPO, ".tmp", "design-system-codemod-"),
);
const UPDATE = process.env.UPDATE_CODEMOD_FIXTURES === "1";

function listFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory()
        ? listFiles(full, base)
        : [path.relative(base, full)];
    })
    .sort();
}

afterAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

describe("design-system codemod fixtures", () => {
  const cases = fs
    .readdirSync(FIXTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it("has fixtures", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const name of cases) {
    it(name, () => {
      const fixture = path.join(FIXTURES, name);
      const work = path.join(SCRATCH, name);
      fs.cpSync(path.join(fixture, "input"), work, { recursive: true });
      const optionsFile = path.join(fixture, "options.json");
      const options: CodemodOptions = fs.existsSync(optionsFile)
        ? JSON.parse(fs.readFileSync(optionsFile, "utf8"))
        : {};

      const result = runCodemod(work, options);
      const written = result.changes.map((change) => {
        const file = path.join(work, change.file);
        fs.writeFileSync(file, change.after);
        return file;
      });
      formatOxfmt(written);
      const report = formatReport(result, ".", { write: true, diff: false });

      const changed = new Set(result.changes.map((change) => change.file));
      const outputDir = path.join(fixture, "output");
      if (UPDATE) {
        fs.rmSync(outputDir, { recursive: true, force: true });
        for (const file of changed) {
          const target = path.join(outputDir, file);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.copyFileSync(path.join(work, file), target);
        }
        fs.writeFileSync(path.join(fixture, "report.txt"), report);
      }

      expect(listFiles(outputDir)).toEqual([...changed].sort());
      // source-read-ok: the fixtures are the codemod's input and expected output, compared after it runs
      for (const file of listFiles(path.join(fixture, "input"))) {
        const actual = fs.readFileSync(path.join(work, file), "utf8");
        const expected = changed.has(file)
          ? fs.readFileSync(path.join(outputDir, file), "utf8")
          : fs.readFileSync(path.join(fixture, "input", file), "utf8");
        expect({ file, contents: actual }).toEqual({
          file,
          contents: expected,
        });
      }
      expect(report).toBe(
        fs.readFileSync(path.join(fixture, "report.txt"), "utf8"),
      );
    });
  }
});
