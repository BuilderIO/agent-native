import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";
import { threadDataToEngineMessages } from "../../agent/thread-data-builder.js";
import { createResourceScriptEntries } from "../../server/agent-chat/script-entries.js";
import { captureCliOutput } from "../../server/cli-capture.js";
import { runWithRequestContext } from "../../server/request-context.js";
import resourceListScript from "./list.js";

vi.mock("../../db/client.js", () => ({
  getDbExec: () => sharedClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

interface FrameworkClient {
  execute(arg: string | { sql: string; args: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
  transaction?<T>(fn: (tx: FrameworkClient) => Promise<T>): Promise<T>;
}

function frameworkClientFor(client: any): FrameworkClient {
  return {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      let parameter = 0;
      const postgresSql = sql.replace(/\?/g, () => `$${++parameter}`);
      const result = await client.query(postgresSql, args);
      return {
        rows: Array.from(result.rows ?? []),
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
    transaction: (fn) =>
      client.transaction((tx: any) => fn(frameworkClientFor(tx))),
  };
}

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

const owner = "alice@example.test";
const SKILL_COUNT = 300;
const skillPaths = Array.from(
  { length: SKILL_COUNT },
  (_, i) => `skills/skill-${String(i + 1).padStart(3, "0")}/SKILL.md`,
);
const pathsIn = (text: string) =>
  [...text.matchAll(/skills\/skill-\d{3}\/SKILL\.md/g)].map((m) => m[0]);

// Numbers, as the model sends them; the tool serializes them to CLI flags.
async function list(args: Record<string, unknown> = {}) {
  const { resources } = await createResourceScriptEntries();
  return runWithRequestContext({ userEmail: owner }, () =>
    resources.run({
      action: "list",
      scope: "personal",
      // Not "skills/": personal defaults add skills/learn/SKILL.md.
      prefix: "skills/skill-",
      ...args,
    } as Record<string, string>),
  );
}

beforeAll(async () => {
  pglite = await createTestPglite();
  sharedClient = frameworkClientFor(pglite.db);
  const { resourcePut } = await import("../../resources/store.js");
  // Seeded in reverse so path order has to come from the list, not the table.
  for (const path of [...skillPaths].reverse()) {
    await resourcePut(owner, path, "---\nname: skill\n---\n", "text/markdown");
  }
  for (const name of ["a", "b", "c"]) {
    await resourcePut(owner, `notes/${name}.md`, name, "text/markdown");
  }
});

afterAll(async () => {
  await pglite.close();
});

describe("resources list pagination (#8556)", () => {
  it("returns the first 50 by path, with the next offset at the top and bottom", async () => {
    const output = await list();

    expect(pathsIn(output)).toEqual(skillPaths.slice(0, 50));
    expect(output.split("\n")[0]).toBe(
      "Resources: 300 (showing 1-50; next offset=50)",
    );
    expect(output.trimEnd().split("\n").at(-1)).toBe(
      "250 more not shown. Next page: repeat this call with offset=50.",
    );
  });

  it("reaches every entry once, in order, by following the next offset", async () => {
    const seen: string[] = [];
    let offset: number | null = 0;
    let calls = 0;
    while (offset !== null) {
      const output = await list({ offset });
      expect(output.length).toBeLessThan(12_000);
      seen.push(...pathsIn(output));
      const next = output.match(/next offset=(\d+)/);
      offset = next ? Number(next[1]) : null;
      if (offset === null) expect(output).toContain("End of list.");
      calls++;
    }

    expect(seen).toEqual(skillPaths);
    expect(calls).toBe(6);
  });

  it("keeps a whole page when the result is replayed into later history", async () => {
    const output = await list();
    const replayed = String(
      threadDataToEngineMessages(
        {
          messages: [
            {
              message: {
                id: "a1",
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "call-1",
                    toolName: "resources",
                    args: { action: "list", prefix: "skills/" },
                    result: output,
                  },
                ],
              },
            },
          ],
        },
        { includeToolCalls: true },
      )
        .flatMap((message) => message.content)
        .find((part) => part.type === "tool-result")?.content,
    );

    expect(replayed).not.toContain("Tool result truncated");
    expect(replayed).toBe(output);
  });

  it("honors limit and reports offsets past the end", async () => {
    const page = await list({ limit: 100, offset: 200 });
    expect(pathsIn(page)).toEqual(skillPaths.slice(200));
    expect(page.split("\n")[0]).toBe("Resources: 300 (showing 201-300)");

    expect(await list({ offset: 400 })).toBe(
      "No resources at offset 400 (300 total).",
    );
  });

  it.each([
    [{ limit: 0 }, "--limit must be a whole number from 1 to 100"],
    [{ limit: 101 }, "--limit must be a whole number from 1 to 100"],
    [{ limit: 1.5 }, "--limit must be a whole number from 1 to 100"],
    [{ limit: "abc" }, "--limit must be a whole number from 1 to 100"],
    [{ offset: -1 }, "--offset must be a whole number, 0 or more"],
  ])("rejects %j instead of ignoring it", async (args, message) => {
    expect(await list(args)).toBe(`Error: ${message}`);
  });

  it("pages json when asked, with the page info ahead of the entries", async () => {
    const output = await list({ format: "json", offset: 0 });
    expect(output.indexOf('"nextOffset": 50')).toBeLessThan(
      output.indexOf('"resources"'),
    );
    expect(
      JSON.parse(output).resources.map((r: { path: string }) => r.path),
    ).toEqual(skillPaths.slice(0, 50));

    const last = JSON.parse(
      await list({ format: "json", limit: 50, offset: 250 }),
    );
    expect(last.resources.map((r: { path: string }) => r.path)).toEqual(
      skillPaths.slice(250),
    );
    expect(last).toMatchObject({
      total: 300,
      offset: 250,
      limit: 50,
      hasMore: false,
      nextOffset: null,
    });
  });

  it("keeps CLI json a bare array unless a page is requested", async () => {
    const output = await runWithRequestContext({ userEmail: owner }, () =>
      captureCliOutput(() =>
        resourceListScript([
          "--scope",
          "personal",
          "--prefix",
          "skills/skill-",
          "--format",
          "json",
        ]),
      ),
    );

    expect(JSON.parse(output).map((r: { path: string }) => r.path)).toEqual(
      skillPaths,
    );
  });

  it("pages json for the agent even without page arguments", async () => {
    expect(JSON.parse(await list({ format: "json" }))).toMatchObject({
      total: 300,
      hasMore: true,
      nextOffset: 50,
    });
  });

  it("prints short lists as before", async () => {
    const output = await list({ prefix: "notes/" });

    expect(output.split("\n")[0]).toBe("Resources: 3");
    expect(output).not.toMatch(/showing|more not shown|End of list/);
  });
});
