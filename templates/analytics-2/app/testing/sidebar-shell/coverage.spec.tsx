// @vitest-environment happy-dom
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vitest";

import index from "./captures.json";
import current from "./current-captures.json";
import { isPresent } from "./row-contracts";
import rows from "./rows.json";
const directory = resolve("app/testing/sidebar-shell");
it("row 822 pairs every selected surface with its complete diagnostic envelope", () => {
  const registered = current.captures.flatMap((capture) => [
    capture.file,
    capture.diagnosticFile,
  ]);
  const witnesses = current.witnesses.map((witness) => witness.file);
  expect(current.files.map((artifact) => artifact.file).sort()).toEqual(
    [...registered, ...witnesses].sort(),
  );
  expect(new Set([...registered, ...witnesses]).size).toBe(
    registered.length + witnesses.length,
  );
  expect(
    readdirSync(resolve(directory, "__goldens__"))
      .filter((file) => file.endsWith(".json"))
      .sort(),
  ).toEqual(
    [...registered, ...witnesses]
      .map((file) => file.replace("__goldens__/", ""))
      .sort(),
  );
  for (const artifact of current.files) {
    const bytes = readFileSync(resolve(directory, artifact.file));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      artifact.sha256,
    );
  }
  for (const capture of current.captures) {
    const surface = JSON.parse(
      readFileSync(resolve(directory, capture.file), "utf8"),
    );
    const diagnostic = JSON.parse(
      readFileSync(resolve(directory, capture.diagnosticFile), "utf8"),
    );
    expect(surface.name).toBe(capture.id);
    expect(surface.rows).toEqual(capture.rowIds);
    const root = document.createElement("div");
    root.innerHTML = surface.markup;
    for (const row of capture.rowIds) expect(isPresent(root, row)).toBe(true);
    expect(diagnostic.name).toBe(capture.id);
    expect(surface.inputs).toEqual(diagnostic.inputs);
    expect(surface.root).toEqual(diagnostic.root);
    expect(
      surface.rows.every((row: string) => diagnostic.rows.includes(row)),
    ).toBe(true);
  }
});
it("accounts for every frozen row and every selected surface, with actual markup presence", () => {
  expect(index.scopeCounts).toEqual({
    swap: 111,
    custom: 3,
    "re-token": 19,
    out: 1,
    "toolkit-rendered": 1,
  });
  expect(rows).toHaveLength(135);
  const paths = new Set(index.captures.map((c) => c.file));
  expect(paths.size).toBe(index.captures.length);
  expect(
    readdirSync(resolve(directory, "reference-fixtures"))
      .filter((f) => f.endsWith("-surface.json"))
      .sort(),
  ).toEqual([...paths].map((f) => f.replace("reference-fixtures/", "")).sort());
  for (const capture of index.captures) {
    const bytes = readFileSync(resolve(directory, capture.file));
    expect(createHash("sha256").update(bytes).digest("hex"), capture.id).toBe(
      capture.sha256,
    );
    const value = JSON.parse(bytes.toString());
    expect(value.rows).toEqual(capture.rowIds);
    const root = document.createElement("div");
    root.innerHTML = value.markup;
    for (const id of capture.rowIds) {
      expect(
        isPresent(root, id),
        `${capture.id} must actually contain ${id}`,
      ).toBe(true);
      expect(rows.some((r) => r.id === id)).toBe(true);
    }
    expect(value.root).toHaveProperty("html");
    expect(value.root).toHaveProperty("body");
    expect(value.root).toHaveProperty("storageEvents");
  }
  for (const row of index.rows) {
    const expected = index.captures
      .filter((c) => c.rowIds.includes(row.id))
      .map((c) => c.id);
    expect(row.captures).toEqual(expected);
    if (row.scope !== "out")
      expect(row.captures.length, `${row.id} has no capture`).toBeGreaterThan(
        0,
      );
    else expect(row.notCapturedReason).toBeTruthy();
  }
});
it("keeps boot/ready/settled witnesses immutable, separate from markup coverage", () => {
  for (const witness of index.witnesses) {
    const bytes = readFileSync(resolve(directory, witness.file));
    expect(createHash("sha256").update(bytes).digest("hex"), witness.id).toBe(
      witness.sha256,
    );
    if (witness.phases.length)
      expect(witness.phases).toEqual(["boot", "ready", "settled"]);
  }
  expect(
    index.witnesses.filter((w) => w.id.startsWith("boot-theme-")),
  ).toHaveLength(40);
  expect(
    index.witnesses.filter((w) => w.id.startsWith("app-inline-boot-")),
  ).toHaveLength(5);
  expect(
    index.witnesses.filter((w) => w.id.startsWith("codec-") && w.phases.length),
  ).toHaveLength(6);
});
