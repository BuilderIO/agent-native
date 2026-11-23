import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  LedgerSet,
  openFixtureLedger,
  readOutstandingFixtures,
} from "./fixture-ledger.js";

const tmp = () => mkdtempSync(join(tmpdir(), "a2-fixture-ledger-"));

void test("an id is on disk the moment it is registered, before any cleanup or flush", () => {
  const path = join(tmp(), "fixtures.jsonl");
  const ledger = openFixtureLedger(path, { echo: false });
  ledger.created("project", "prj_one");
  assert.deepEqual(readOutstandingFixtures(path), [
    { kind: "project", id: "prj_one" },
  ]);
});

void test("cleaned ids leave the outstanding list; others stay", () => {
  const path = join(tmp(), "fixtures.jsonl");
  const ledger = openFixtureLedger(path, { echo: false });
  ledger.created("project", "prj_a");
  ledger.created("dataset", "ds_a");
  ledger.created("thread", "th_a");
  ledger.cleaned("dataset", "ds_a");
  assert.deepEqual(readOutstandingFixtures(path), [
    { kind: "project", id: "prj_a" },
    { kind: "thread", id: "th_a" },
  ]);
});

void test("a torn trailing line and a re-registered id do not hide or duplicate fixtures", () => {
  const path = join(tmp(), "fixtures.jsonl");
  const ledger = openFixtureLedger(path, { echo: false });
  ledger.created("project", "prj_a");
  ledger.created("project", "prj_a");
  appendFileSync(path, '{"event":"created","kind":"proj');
  assert.deepEqual(readOutstandingFixtures(path), [
    { kind: "project", id: "prj_a" },
  ]);
});

void test("a missing ledger reads as no fixtures instead of throwing", () => {
  assert.deepEqual(readOutstandingFixtures(join(tmp(), "none.jsonl")), []);
});

void test("LedgerSet records on add, marks cleaned on delete, and still iterates for cleanup", () => {
  const path = join(tmp(), "fixtures.jsonl");
  const projects = new LedgerSet(
    openFixtureLedger(path, { echo: false }),
    "project",
  );
  projects.add("prj_a");
  projects.add("prj_b");
  projects.delete("prj_a");
  assert.deepEqual([...projects], ["prj_b"]);
  assert.deepEqual(readOutstandingFixtures(path), [
    { kind: "project", id: "prj_b" },
  ]);
});

void test("ids survive a killed checker process and each is echoed unbuffered on stderr", () => {
  const dir = tmp();
  const path = join(dir, "fixtures.jsonl");
  const script = join(dir, "child.ts");
  writeFileSync(
    script,
    `import { openFixtureLedger } from ${JSON.stringify(new URL("./fixture-ledger.ts", import.meta.url).href)};
const l = openFixtureLedger(process.argv[2]);
l.created("project", "prj_killed");
l.created("dataset", "ds_killed");
process.kill(process.pid, "SIGKILL");
`,
  );
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", script, path],
    { encoding: "utf8" },
  );
  assert.equal(result.signal, "SIGKILL");
  assert.deepEqual(readOutstandingFixtures(path), [
    { kind: "project", id: "prj_killed" },
    { kind: "dataset", id: "ds_killed" },
  ]);
  assert.match(result.stderr, /FIXTURE created project prj_killed/);
  assert.match(result.stderr, /FIXTURE created dataset ds_killed/);
});

void test("core-flows registers every fixture through the ledger, never a plain Set", () => {
  const source = readFileSync(
    new URL("./core-flows.ts", import.meta.url),
    "utf8",
  );
  for (const name of ["projects", "datasets", "threads"])
    assert.doesNotMatch(
      source,
      new RegExp(`const ${name} = new Set<string>\\(\\)`),
      `${name} must be a LedgerSet so created ids are durable`,
    );
  assert.match(source, /new LedgerSet\(/);
});
