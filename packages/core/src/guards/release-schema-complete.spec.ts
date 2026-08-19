import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanReleaseSchemaCoverage } from "./release-schema-complete.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** A miniature core package: the release list plus whatever stores are given. */
function makeCore(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-schema-guard-"));
  tempRoots.push(root);
  const coreDir = path.join(root, "packages", "core");
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(coreDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

const listWith = (specs: string[]) =>
  specs.map((spec) => `import { ensureTable } from "${spec}";`).join("\n");

const STORE = `
import { ensureTableExists } from "../db/ddl-guard.js";
export async function ensureTable(): Promise<void> {
  await ensureTableExists("widgets", "CREATE TABLE IF NOT EXISTS widgets (id TEXT)");
}
`;

describe("scanReleaseSchemaCoverage", () => {
  it("passes when every store defining schema is in the release list", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith(["../widgets/store.js"]),
      "src/widgets/store.ts": STORE,
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  // The bug this guard exists for: a store whose tables nothing can create on a
  // hosted deploy, because production serverless never runs `ensureTable()`.
  it("flags a store that defines schema and is not in the list", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith(["../widgets/store.js"]),
      "src/widgets/store.ts": STORE,
      "src/gadgets/store.ts": STORE,
    });

    const { findings } = scanReleaseSchemaCoverage({ root });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: "src/gadgets/store.ts",
      message: expect.stringContaining("never created on a hosted deploy"),
    });
  });

  it("ignores files that only name ensureTableExists in a comment", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith([]),
      "src/docs/notes.ts": `
        // Stores call ensureTableExists() to define their schema.
        /* See ensureTableExists( ) in db/ddl-guard.ts. */
        export const NOTE = 1;
      `,
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  it("ignores specs, and the ddl-guard that implements the probe", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith([]),
      "src/widgets/store.spec.ts": STORE,
      "src/db/ddl-guard.ts": STORE,
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  it("honours a reviewed opt-out marker", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith([]),
      "src/widgets/store.ts": `// guard:allow-unreleased-schema - local dev tooling only\n${STORE}`,
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  // A missing list is the one failure that must not read as "nothing to check":
  // deleting it would stop every framework table from being created at release.
  it("fails loudly when the release list itself is gone", () => {
    const root = makeCore({ "src/widgets/store.ts": STORE });

    const { findings } = scanReleaseSchemaCoverage({ root });

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("src/server/release-schema.ts");
  });
});
