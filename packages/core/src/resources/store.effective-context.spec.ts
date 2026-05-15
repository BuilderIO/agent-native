import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../db/client.js", () => ({
  getDbExec: () => sharedClient,
  isPostgres: () => false,
  intType: () => "INTEGER",
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

interface FrameworkClient {
  execute(arg: string | { sql: string; args: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
}

let sqlite: Database.Database;
let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

beforeAll(() => {
  sqlite = new Database(":memory:");
  sharedClient = {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      const stmt = sqlite.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = stmt.all(...args) as any[];
        return { rows, rowsAffected: 0 };
      }
      const result = stmt.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
  };
});

afterAll(() => {
  sqlite.close();
});

describe("resourceEffectiveContext", () => {
  it("resolves personal > organization/app > workspace for instruction, skill, AGENTS, and context paths", async () => {
    const {
      SHARED_OWNER,
      WORKSPACE_OWNER,
      resourceDeleteByPath,
      resourceEffectiveContext,
      resourcePut,
    } = await import("./store.js");

    const user = "person+effective@example.test";
    const paths = [
      "AGENTS.md",
      "instructions/guardrails.md",
      "skills/company-voice/SKILL.md",
      "context/brand.md",
    ];

    for (const path of paths) {
      await resourcePut(WORKSPACE_OWNER, path, `workspace ${path}`);
      await resourcePut(SHARED_OWNER, path, `shared ${path}`);
      await resourcePut(user, path, `personal ${path}`);

      const personal = await resourceEffectiveContext(user, path);
      expect(personal.effectiveScope).toBe("personal");
      expect(personal.layers.map((layer) => layer.scope)).toEqual([
        "workspace",
        "shared",
        "personal",
      ]);
      expect(
        personal.layers.find((layer) => layer.scope === "personal"),
      ).toMatchObject({ exists: true, effective: true, overridden: false });
      expect(
        personal.layers.find((layer) => layer.scope === "shared"),
      ).toMatchObject({ exists: true, effective: false, overridden: true });
      expect(
        personal.layers.find((layer) => layer.scope === "workspace"),
      ).toMatchObject({ exists: true, effective: false, overridden: true });

      await resourceDeleteByPath(user, path);
      const shared = await resourceEffectiveContext(user, path);
      expect(shared.effectiveScope).toBe("shared");
      expect(
        shared.layers.find((layer) => layer.scope === "shared"),
      ).toMatchObject({ exists: true, effective: true, overridden: false });

      await resourceDeleteByPath(SHARED_OWNER, path);
      const workspace = await resourceEffectiveContext(user, path);
      expect(workspace.effectiveScope).toBe("workspace");
      expect(
        workspace.layers.find((layer) => layer.scope === "workspace"),
      ).toMatchObject({ exists: true, effective: true, overridden: false });
    }
  });
});
