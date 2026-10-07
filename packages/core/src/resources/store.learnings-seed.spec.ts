import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

vi.mock("../db/client.js", () => ({
  getDbExec: () => sharedClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

interface FrameworkClient {
  execute(arg: string | { sql: string; args: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
}

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

function bindClientTo(db: Awaited<ReturnType<typeof createTestPglite>>): void {
  sharedClient = {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      const stmt = await db.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = (await stmt.all(...args)) as any[];
        return { rows, rowsAffected: 0 };
      }
      const result = await stmt.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
  };
}

function previousLearnSharedSeed(content: string): string {
  return content
    .replace(
      "  Review and update shared LEARNINGS.md with explicitly approved organization-wide\n  preferences, corrections, and patterns from this session.",
      "  Update the shared LEARNINGS.md with team-wide preferences, corrections, and\n  patterns from this session.",
    )
    .replace(
      "Review the current conversation for findings that are useful across the organization. Keep setup-specific findings in personal memory or the current analysis. Before writing a finding to shared `LEARNINGS.md` or organization memory, confirm that the user intends it to be shared unless they directly requested that shared write. A generic request to remember something does not authorize sharing it.",
      "Review the current conversation and update the shared `LEARNINGS.md` resource with anything the whole team should know.",
    )
    .replace(
      "3. Merge approved shared learnings with existing ones — don't duplicate, refine existing entries",
      "3. Merge new learnings with existing ones — don't duplicate, refine existing entries",
    )
    .replace(
      '4. Write back with the `resources` tool only after the user has approved the shared write: `action: "write"`, `path: "LEARNINGS.md"`, `scope: "shared"`, `content: "..."`',
      '4. Write back with the `resources` tool: `action: "write"`, `path: "LEARNINGS.md"`, `scope: "shared"`, `content: "..."`',
    );
}

async function insertLegacyLearnSharedSeed(
  owner: string,
  content: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await sharedClient.execute({
    sql: `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      "skills/learn-shared.md",
      owner,
      content,
      "text/markdown",
      Buffer.byteLength(content, "utf8"),
      now,
      now,
    ],
  });
  return id;
}

let tempDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  pglite = await createTestPglite();
  bindClientTo(pglite);
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "learnings-seed-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
});

afterAll(async () => {
  cwdSpy.mockRestore();
  fs.rmSync(tempDir, { recursive: true, force: true });
  await pglite.close();
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
    const freshDb = await createTestPglite();
    bindClientTo(freshDb);
    try {
      vi.resetModules();
      const { SHARED_OWNER, resourceGetByPath } = await import("./store.js");

      const resource = await resourceGetByPath(SHARED_OWNER, "LEARNINGS.md");

      expect(resource).not.toBeNull();
      expect(resource?.content).toContain(
        "User preferences, corrections, and patterns",
      );
      const learnShared = await resourceGetByPath(
        SHARED_OWNER,
        "skills/learn-shared/SKILL.md",
      );
      expect(learnShared?.content).toContain(
        "A generic request to remember something does not authorize sharing it",
      );
    } finally {
      bindClientTo(pglite);
      freshDb.close();
    }
  });

  it("migrates the untouched shared learn-shared default on an already-seeded database", async () => {
    const freshDb = await createTestPglite();
    bindClientTo(freshDb);
    try {
      vi.resetModules();
      const first = await import("./store.js");
      const seeded = await first.resourceGetByPath(
        first.SHARED_OWNER,
        "skills/learn-shared/SKILL.md",
      );
      expect(seeded).not.toBeNull();
      if (!seeded)
        throw new Error("The shared learn-shared skill was not seeded.");

      const previousContent = previousLearnSharedSeed(seeded.content);
      expect(previousContent).not.toBe(seeded.content);
      const legacyId = await insertLegacyLearnSharedSeed(
        first.SHARED_OWNER,
        previousContent,
      );
      await sharedClient.execute({
        sql: "UPDATE resources SET content = ?, size = ? WHERE id = ?",
        args: [
          previousContent,
          Buffer.byteLength(previousContent, "utf8"),
          seeded.id,
        ],
      });
      await sharedClient.execute({
        sql: "DELETE FROM public.settings WHERE key = ?",
        args: ["resources-migrated:shared:learn-shared-approval:v1"],
      });

      vi.resetModules();
      const second = await import("./store.js");
      const migrated = await second.resourceGetByPath(
        second.SHARED_OWNER,
        "skills/learn-shared/SKILL.md",
      );
      const migratedLegacy = await second.resourceGetByPath(
        second.SHARED_OWNER,
        "skills/learn-shared.md",
      );

      expect(migrated?.content).toBe(seeded.content);
      expect(migrated?.id).toBe(seeded.id);
      expect(migrated?.size).toBe(Buffer.byteLength(seeded.content, "utf8"));
      expect(migratedLegacy?.content).toBe(seeded.content);
      expect(migratedLegacy?.id).toBe(legacyId);
      expect(migratedLegacy?.size).toBe(
        Buffer.byteLength(seeded.content, "utf8"),
      );
    } finally {
      bindClientTo(pglite);
      freshDb.close();
    }
  });

  it("preserves edits when the shared learn-shared default migration runs", async () => {
    const freshDb = await createTestPglite();
    bindClientTo(freshDb);
    try {
      vi.resetModules();
      const first = await import("./store.js");
      const seeded = await first.resourceGetByPath(
        first.SHARED_OWNER,
        "skills/learn-shared/SKILL.md",
      );
      expect(seeded).not.toBeNull();
      if (!seeded)
        throw new Error("The shared learn-shared skill was not seeded.");

      const previousContent = previousLearnSharedSeed(seeded.content);
      const customizedContent =
        previousContent + "\n\n## Team additions\n\nKeep this edit.\n";
      const customizedLegacyContent =
        previousContent +
        "\n\n## Legacy team additions\n\nKeep this edit too.\n";
      const legacyId = await insertLegacyLearnSharedSeed(
        first.SHARED_OWNER,
        customizedLegacyContent,
      );
      await sharedClient.execute({
        sql: "UPDATE resources SET content = ?, size = ? WHERE id = ?",
        args: [
          customizedContent,
          Buffer.byteLength(customizedContent, "utf8"),
          seeded.id,
        ],
      });
      await sharedClient.execute({
        sql: "DELETE FROM public.settings WHERE key = ?",
        args: ["resources-migrated:shared:learn-shared-approval:v1"],
      });

      vi.resetModules();
      const second = await import("./store.js");
      const unchanged = await second.resourceGetByPath(
        second.SHARED_OWNER,
        "skills/learn-shared/SKILL.md",
      );
      const unchangedLegacy = await second.resourceGetByPath(
        second.SHARED_OWNER,
        "skills/learn-shared.md",
      );

      expect(unchanged?.content).toBe(customizedContent);
      expect(unchanged?.id).toBe(seeded.id);
      expect(unchangedLegacy?.content).toBe(customizedLegacyContent);
      expect(unchangedLegacy?.id).toBe(legacyId);
    } finally {
      bindClientTo(pglite);
      freshDb.close();
    }
  });

  it("falls back to the checked-in learnings.defaults.md when learnings.md is absent", async () => {
    fs.rmSync(path.join(tempDir, "learnings.md"), { force: true });
    fs.writeFileSync(
      path.join(tempDir, "learnings.defaults.md"),
      "# Learnings\n\n- Checked-in defaults entry\n",
    );
    const freshDb = await createTestPglite();
    bindClientTo(freshDb);
    try {
      vi.resetModules();
      const { SHARED_OWNER, resourceGetByPath } = await import("./store.js");

      const resource = await resourceGetByPath(SHARED_OWNER, "LEARNINGS.md");

      expect(resource?.content).toContain("Checked-in defaults entry");
    } finally {
      bindClientTo(pglite);
      freshDb.close();
      fs.rmSync(path.join(tempDir, "learnings.defaults.md"), { force: true });
    }
  });

  it("ignores an empty project-root learnings.md and seeds the default", async () => {
    fs.writeFileSync(path.join(tempDir, "learnings.md"), "   \n\n  ");
    const freshDb = await createTestPglite();
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
      bindClientTo(pglite);
      freshDb.close();
      fs.rmSync(path.join(tempDir, "learnings.md"), { force: true });
    }
  });
});
