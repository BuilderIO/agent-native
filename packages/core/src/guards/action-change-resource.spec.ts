import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanActionChangeResource } from "./action-change-resource.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function scanAction(source: string, file = "actions/update.ts") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-change-resource-"));
  roots.push(root);
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), source);
  return scanActionChangeResource({ root }).findings;
}

const resolveOnly = `export default defineAction({
  run: async ({ id }) => {
    const access = await resolveAccess("deck", id);
  },
});
`;

describe("scanActionChangeResource", () => {
  it("flags a mutating action that only resolves access", () => {
    expect(scanAction(resolveOnly)).toEqual([
      expect.objectContaining({ file: "actions/update.ts", line: 1 }),
    ]);
  });

  it.each([
    ["a declared changeResource", "  changeResource: () => null,\n"],
    ["readOnly", "  readOnly: true,\n"],
    ["changeEvents: false", "  changeEvents: false,\n"],
    ["a GET route", '  http: { method: "GET" },\n'],
    ["a read plan-mode effect", '  planMode: { effect: "read" },\n'],
    [
      "a write-level assertAccess",
      '  check: () => assertAccess("deck", id, "editor"),\n',
    ],
    [
      "a write-level declarative access",
      '  access: { resource: { type: "deck", idFrom: "id", level: "admin" } },\n',
    ],
  ])("accepts %s", (_label, option) => {
    expect(
      scanAction(
        resolveOnly.replace("defineAction({\n", `defineAction({\n${option}`),
      ),
    ).toEqual([]);
  });

  it("does not count a viewer-level assertAccess as a write", () => {
    expect(
      scanAction(
        resolveOnly.replace(
          "defineAction({\n",
          'defineAction({\n  check: () => assertAccess("deck", id, "viewer"),\n',
        ),
      ),
    ).toHaveLength(1);
  });

  it("ignores tests and files outside actions/", () => {
    expect(scanAction(resolveOnly, "actions/update.spec.ts")).toEqual([]);
    expect(scanAction(resolveOnly, "server/update.ts")).toEqual([]);
  });

  it("honors the opt-out pragma", () => {
    expect(
      scanAction(
        `// guard:allow-action-change-resource: fixture\n${resolveOnly}`,
      ),
    ).toEqual([]);
  });
});
