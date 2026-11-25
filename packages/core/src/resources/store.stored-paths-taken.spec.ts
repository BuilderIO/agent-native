import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";

vi.mock("../db/client.js", () => ({
  getEnclosingTransactionDbExec: () => undefined,
  getDbExec: () => sharedClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let sharedClient: DbExec = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

beforeAll(async () => {
  pglite = await createTestPglite();
  sharedClient = {
    async execute(input) {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await pglite.query(input.sql, [...(input.args ?? [])]);
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
    transaction: pglite.transaction,
  };
});

afterAll(async () => {
  await pglite.close();
});

describe("resourceStoredPathsTaken", () => {
  it("finds the rows stored for exactly that owner, scratch ones included", async () => {
    const { ensureResourceStoreReady, resourceStoredPathsTaken } =
      await import("./store.js");
    await ensureResourceStoreReady();
    await pglite.exec(`
      INSERT INTO resources (id, path, owner, content, created_at, updated_at, visibility)
      VALUES
        ('mine', 'notes/todo.md', 'erin@example.test', 'a', 1, 1, 'workspace'),
        ('scratch', 'notes/todo-2.md', 'erin@example.test', 'b', 1, 1, 'agent_scratch'),
        ('org', 'notes/todo-3.md', '__organization__:org-1', 'c', 1, 1, 'workspace'),
        ('theirs', 'notes/todo-4.md', 'sam@example.test', 'd', 1, 1, 'workspace');
    `);

    await expect(
      resourceStoredPathsTaken("erin@example.test", [
        "notes/todo.md",
        "notes/todo-2.md",
        "notes/todo-3.md",
        "notes/todo-4.md",
        "notes/todo-5.md",
      ]),
    ).resolves.toEqual(new Set(["notes/todo.md", "notes/todo-2.md"]));
    await expect(
      resourceStoredPathsTaken("erin@example.test", []),
    ).resolves.toEqual(new Set());
  });

  it("counts only the shared files from before organizations that the organization can see", async () => {
    const { SHARED_OWNER, ensureResourceStoreReady, resourceStoredPathsTaken } =
      await import("./store.js");
    await ensureResourceStoreReady();
    const orgFile = (orgId: string) =>
      JSON.stringify({
        source: "workspace-files",
        scope: "org",
        scopeId: orgId,
      });
    await pglite.query(
      `INSERT INTO resources (id, path, owner, content, created_at, updated_at, metadata)
       VALUES
         ('legacy-a', 'plans/q1.md', $1, 'a', 1, 1, $2),
         ('legacy-b', 'plans/q1-2.md', $1, 'b', 1, 1, $3),
         ('shared', 'plans/q1-3.md', $1, 'c', 1, 1, NULL)`,
      [SHARED_OWNER, orgFile("org-a"), orgFile("org-b")],
    );
    const paths = ["plans/q1.md", "plans/q1-2.md", "plans/q1-3.md"];

    await expect(
      resourceStoredPathsTaken(SHARED_OWNER, paths, { orgId: "org-a" }),
    ).resolves.toEqual(new Set(["plans/q1.md", "plans/q1-3.md"]));
    await expect(
      resourceStoredPathsTaken(SHARED_OWNER, paths),
    ).resolves.toEqual(new Set(paths));
  });

  it("counts only the rows holding exactly the content and type asked for", async () => {
    const { ensureResourceStoreReady, resourceStoredPathsTaken } =
      await import("./store.js");
    await ensureResourceStoreReady();
    await pglite.exec(`
      INSERT INTO resources (id, path, owner, content, mime_type, created_at, updated_at)
      VALUES
        ('same', 'drafts/a.md', 'kim@example.test', '# Same', 'text/markdown', 1, 1),
        ('other-text', 'drafts/a-2.md', 'kim@example.test', '# Other', 'text/markdown', 1, 1),
        ('other-type', 'drafts/a-3.md', 'kim@example.test', '# Same', 'text/plain', 1, 1),
        ('other-owner', 'drafts/a-4.md', 'lee@example.test', '# Same', 'text/markdown', 1, 1);
    `);

    await expect(
      resourceStoredPathsTaken(
        "kim@example.test",
        ["drafts/a.md", "drafts/a-2.md", "drafts/a-3.md", "drafts/a-4.md"],
        { holding: { content: "# Same", mimeType: "text/markdown" } },
      ),
    ).resolves.toEqual(new Set(["drafts/a.md"]));
  });

  it("finds local workspace files on disk, not rows", async () => {
    const {
      WORKSPACE_OWNER,
      isSameLocalWorkspaceFile,
      resourcePutIfSnapshot,
      resourceStoredPathsTaken,
    } = await import("./store.js");
    const { writeLocalWorkspaceResource } =
      await import("../local-artifacts/index.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-stored-paths-"));
    const previousManifest = process.env.AGENT_NATIVE_MANIFEST;
    const previousManifestPath = process.env.AGENT_NATIVE_MANIFEST_PATH;
    try {
      const manifestPath = path.join(root, "agent-native.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          mode: "local-files",
          apps: {
            content: { roots: [{ path: "content", extensions: [".mdx"] }] },
          },
        }),
        "utf8",
      );
      fs.writeFileSync(path.join(root, "AGENTS.md"), "# Agents", "utf8");
      fs.mkdirSync(path.join(root, ".agents", "skills", "review"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(root, ".agents", "skills", "review", "SKILL.md"),
        "# Review",
        "utf8",
      );
      process.env.AGENT_NATIVE_MANIFEST = manifestPath;
      delete process.env.AGENT_NATIVE_MANIFEST_PATH;
      await pglite.exec(`
        INSERT INTO resources (id, path, owner, content, created_at, updated_at)
        VALUES ('row', 'skills/draft/SKILL.md', '__workspace__', 'e', 1, 1);
      `);

      await expect(
        resourceStoredPathsTaken(
          WORKSPACE_OWNER,
          [
            "AGENTS.md",
            "skills/review/SKILL.md",
            // The same skill, spelled with the other skill root.
            ".agent/skills/review/SKILL.md",
            "skills/draft/SKILL.md",
            "notes/todo.md",
          ],
          { localFiles: true },
        ),
      ).resolves.toEqual(
        new Set([
          "AGENTS.md",
          "skills/review/SKILL.md",
          ".agent/skills/review/SKILL.md",
        ]),
      );

      // A rename's create-only write leaves a file that is already there.
      await expect(
        resourcePutIfSnapshot({
          previous: null,
          owner: WORKSPACE_OWNER,
          path: "skills/review/SKILL.md",
          content: "# Moved here",
        }),
      ).resolves.toBeNull();
      await expect(
        writeLocalWorkspaceResource({
          path: "skills/review/SKILL.md",
          content: "# Moved here",
          ifNotExists: true,
        }),
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(
        fs.readFileSync(
          path.join(root, ".agents", "skills", "review", "SKILL.md"),
          "utf8",
        ),
      ).toBe("# Review");
      // Nor does it add a second copy of that skill in the other skill root.
      await expect(
        resourcePutIfSnapshot({
          previous: null,
          owner: WORKSPACE_OWNER,
          path: ".agent/skills/review/SKILL.md",
          content: "# Moved here",
        }),
      ).resolves.toBeNull();
      expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);

      // A free path is claimed whole, with no temp file left beside it.
      const created = await resourcePutIfSnapshot({
        previous: null,
        owner: WORKSPACE_OWNER,
        path: "skills/fresh/SKILL.md",
        content: "# Fresh",
      });
      if (!created) throw new Error("the free path wasn't written");
      const { absolutePath } = JSON.parse(
        String(created.resource.metadata),
      ) as { absolutePath: string };
      expect(fs.readFileSync(absolutePath, "utf8")).toBe("# Fresh");
      expect(fs.readdirSync(path.dirname(absolutePath))).toEqual(["SKILL.md"]);

      await expect(
        isSameLocalWorkspaceFile({
          path: "skills/review/SKILL.md",
          otherPath: ".agents/skills/review/SKILL.md",
        }),
      ).resolves.toBe(true);
      // Not on disk under .agent/, but deleting the skill would remove it
      // from both roots.
      await expect(
        isSameLocalWorkspaceFile({
          path: "skills/review/SKILL.md",
          otherPath: ".agent/skills/review/SKILL.md",
        }),
      ).resolves.toBe(true);
      await expect(
        isSameLocalWorkspaceFile({
          path: "skills/review/SKILL.md",
          otherPath: "AGENTS.md",
        }),
      ).resolves.toBe(false);
      await expect(
        isSameLocalWorkspaceFile({
          path: "skills/review/SKILL.md",
          otherPath: "skills/missing/SKILL.md",
        }),
      ).resolves.toBe(false);
    } finally {
      if (previousManifest === undefined) {
        delete process.env.AGENT_NATIVE_MANIFEST;
      } else {
        process.env.AGENT_NATIVE_MANIFEST = previousManifest;
      }
      if (previousManifestPath === undefined) {
        delete process.env.AGENT_NATIVE_MANIFEST_PATH;
      } else {
        process.env.AGENT_NATIVE_MANIFEST_PATH = previousManifestPath;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
