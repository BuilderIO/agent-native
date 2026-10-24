import { describe, expect, it, vi } from "vitest";

const loads = vi.hoisted(() => ({ schema: 0, query: 0, exec: 0, patch: 0 }));
const calls = vi.hoisted(() => [] as Array<[string, string[]]>);

function script(name: keyof typeof loads) {
  loads[name] += 1;
  return {
    default: async (args: string[]) => {
      calls.push([name, args]);
      console.log(`${name} ran`);
    },
  };
}

vi.mock("../../scripts/db/schema.js", () => script("schema"));
vi.mock("../../scripts/db/query.js", () => script("query"));
vi.mock("../../scripts/db/exec.js", () => script("exec"));
vi.mock("../../scripts/db/patch.js", () => script("patch"));

import { createDbScriptEntries } from "./script-entries.js";

describe("database script entries", () => {
  it("loads a script's module on its first call, once across concurrent calls", async () => {
    const entries = await createDbScriptEntries("write");

    expect(Object.keys(entries)).toEqual([
      "db-schema",
      "db-query",
      "db-exec",
      "db-patch",
    ]);
    expect(loads).toEqual({ schema: 0, query: 0, exec: 0, patch: 0 });

    const outputs = await Promise.all([
      entries["db-query"]!.run({ sql: "select 1" }),
      entries["db-query"]!.run({ sql: "select 2" }),
    ]);

    expect(outputs).toEqual(["query ran", "query ran"]);
    expect(loads).toEqual({ schema: 0, query: 1, exec: 0, patch: 0 });
    expect(calls).toEqual([
      ["query", ["--sql", "select 1"]],
      ["query", ["--sql", "select 2"]],
    ]);
  });

  it("keeps the write scripts out of read mode", async () => {
    const entries = await createDbScriptEntries("read");

    expect(Object.keys(entries)).toEqual(["db-schema", "db-query"]);
  });
});
