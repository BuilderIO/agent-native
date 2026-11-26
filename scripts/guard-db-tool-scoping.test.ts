import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  checkDbToolScoping,
  readManifestDenylist,
} from "./guard-db-tool-scoping.mjs";

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const UNSCOPED_SCHEMA = `export const ledger = table("notes_ledger", {
  id: text("id").primaryKey(),
});
`;

function repo(template: string, manifest?: unknown): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "db-tool-scoping-"));
  roots.push(root);
  const dir = path.join(root, "templates", template);
  mkdirSync(path.join(dir, "server", "db"), { recursive: true });
  writeFileSync(path.join(dir, "server", "db", "schema.ts"), UNSCOPED_SCHEMA);
  if (manifest !== undefined) {
    writeFileSync(
      path.join(dir, "agent-native.json"),
      typeof manifest === "string" ? manifest : JSON.stringify(manifest),
    );
  }
  return root;
}

describe("db tool scoping guard", () => {
  it("flags an unscoped table that no list names", async () => {
    const result = await checkDbToolScoping(repo("notes"));
    assert.deepEqual(
      result.findings.map((finding: { key: string }) => finding.key),
      ["notes:notes_ledger"],
    );
  });

  it("accepts a table the template's own manifest denylists", async () => {
    const root = repo("notes", {
      doctor: {
        dbToolScopingDenylist: { notes_ledger: "retry ledger, no content" },
      },
    });
    const result = await checkDbToolScoping(root);
    assert.deepEqual(result.findings, []);
  });

  it("does not let one template's manifest cover another template's table", async () => {
    const root = repo("notes");
    const other = path.join(root, "templates", "boards");
    mkdirSync(other, { recursive: true });
    writeFileSync(
      path.join(other, "agent-native.json"),
      JSON.stringify({
        doctor: { dbToolScopingDenylist: { notes_ledger: "wrong app" } },
      }),
    );
    const result = await checkDbToolScoping(root);
    assert.equal(result.findings.length, 1);
  });

  it("refuses a malformed manifest instead of reading it as no entries", async () => {
    for (const manifest of [
      "{ not json",
      { doctor: { dbToolScopingDenylist: ["notes_ledger"] } },
      { doctor: { dbToolScopingDenylist: { notes_ledger: "" } } },
      { doctor: { dbToolScopingDenylist: { notes_ledger: 1 } } },
    ]) {
      const root = repo("notes", manifest);
      await assert.rejects(checkDbToolScoping(root));
      assert.throws(() =>
        readManifestDenylist(path.join(root, "templates", "notes")),
      );
    }
  });

  it("runs the check when invoked through a symlink", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "db-tool-scoping-link-"));
    roots.push(dir);
    const link = path.join(dir, "guard.mjs");
    symlinkSync(
      path.join(import.meta.dirname, "guard-db-tool-scoping.mjs"),
      link,
    );
    const run = spawnSync(process.execPath, [link], { encoding: "utf8" });
    assert.match(`${run.stdout}${run.stderr}`, /guard-db-tool-scoping:/);
  });

  it("reads an absent manifest or field as no entries", () => {
    assert.deepEqual(
      readManifestDenylist(path.join(repo("notes"), "templates", "notes")),
      {},
    );
    assert.deepEqual(
      readManifestDenylist(
        path.join(repo("notes", { doctor: {} }), "templates", "notes"),
      ),
      {},
    );
  });
});
