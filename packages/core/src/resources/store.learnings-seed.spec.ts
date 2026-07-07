import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

function bindClientTo(db: Database.Database): void {
  sharedClient = {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      const stmt = db.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = stmt.all(...args) as any[];
        return { rows, rowsAffected: 0 };
      }
      const result = stmt.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
  };
}

let tempDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  sqlite = new Database(":memory:");
  bindClientTo(sqlite);
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "learnings-seed-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
});

afterAll(() => {
  cwdSpy.mockRestore();
  fs.rmSync(tempDir, { recursive: true, force: true });
  sqlite.close();
});

describe("shared LEARNINGS.md boot seeding", () => {
  it("seeds shared LEARNINGS.md from the project-root learnings.md on first boot", async () => {
    fs.writeFileSync(
      path.join(tempDir, "learnings.md"),
      "# Learnings\n\n- Template-authored seed entry\n",
    );
    vi.resetModules();
    const { SHARED_OWNER, resourceGetByPath } = await import("./store.js");

    const resource = await resourceGetByPath(SHARED_OWNER, "LEARNINGS.md");

    expect(resource).not.toBeNull();
    expect(resource?.content).toContain("Template-authored seed entry");
    expect(resource?.mimeType).toBe("text/markdown");
  });

  it("never overwrites an existing LEARNINGS.md resource on later boots", async () => {
    // Same database, fresh module state (as after a server restart), and a
    // changed project-root file — the existing resource row must win.
    fs.writeFileSync(
      path.join(tempDir, "learnings.md"),
      "# Learnings\n\n- Changed after first boot\n",
    );
    vi.resetModules();
    const { SHARED_OWNER, resourceGetByPath } = await import("./store.js");

    const resource = await resourceGetByPath(SHARED_OWNER, "LEARNINGS.md");

    expect(resource?.content).toContain("Template-authored seed entry");
    expect(resource?.content).not.toContain("Changed after first boot");
  });

  it("falls back to the built-in default when no project-root learnings.md exists", async () => {
    fs.rmSync(path.join(tempDir, "learnings.md"), { force: true });
    const freshDb = new Database(":memory:");
    bindClientTo(freshDb);
    try {
      vi.resetModules();
      const { SHARED_OWNER, resourceGetByPath } = await import("./store.js");

      const resource = await resourceGetByPath(SHARED_OWNER, "LEARNINGS.md");

      expect(resource).not.toBeNull();
      expect(resource?.content).toContain(
        "User preferences, corrections, and patterns",
      );
    } finally {
      bindClientTo(sqlite);
      freshDb.close();
    }
  });

  it("falls back to the checked-in learnings.defaults.md when learnings.md is absent", async () => {
    // Production deploys built from git only carry learnings.defaults.md —
    // the scaffolded learnings.md copy is gitignored.
    fs.rmSync(path.join(tempDir, "learnings.md"), { force: true });
    fs.writeFileSync(
      path.join(tempDir, "learnings.defaults.md"),
      "# Learnings\n\n- Checked-in defaults entry\n",
    );
    const freshDb = new Database(":memory:");
    bindClientTo(freshDb);
    try {
      vi.resetModules();
      const { SHARED_OWNER, resourceGetByPath } = await import("./store.js");

      const resource = await resourceGetByPath(SHARED_OWNER, "LEARNINGS.md");

      expect(resource?.content).toContain("Checked-in defaults entry");
    } finally {
      bindClientTo(sqlite);
      freshDb.close();
      fs.rmSync(path.join(tempDir, "learnings.defaults.md"), { force: true });
    }
  });

  it("ignores an empty project-root learnings.md and seeds the default", async () => {
    fs.writeFileSync(path.join(tempDir, "learnings.md"), "   \n\n  ");
    const freshDb = new Database(":memory:");
    bindClientTo(freshDb);
    try {
      vi.resetModules();
      const { SHARED_OWNER, resourceGetByPath } = await import("./store.js");

      const resource = await resourceGetByPath(SHARED_OWNER, "LEARNINGS.md");

      expect(resource).not.toBeNull();
      expect(resource?.content).toContain(
        "User preferences, corrections, and patterns",
      );
    } finally {
      bindClientTo(sqlite);
      freshDb.close();
      fs.rmSync(path.join(tempDir, "learnings.md"), { force: true });
    }
  });
});
