import { createHash } from "node:crypto";

import type { ActionRunContext } from "@agent-native/core/action";
import { closeDbExec, type DbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  COMPONENT_DELETE_CHECKPOINT_LABEL,
  createDesignChatBeginningSnapshot,
  createDesignVersionSnapshot,
  readDesignVersionFile,
  readDesignVersionSnapshot,
  restoreDesignVersion,
  snapshotDesignBeforeAgentEdit,
  snapshotDesignBeforeAgentEditInVersionLock,
} from "./design-versions.js";
import {
  DESIGN_OWNER,
  agentToolContext,
  bootDesignDatabase,
  seedDesign,
} from "./failed-write-test-harness.js";
import { firstRow } from "./visual-edit-capability.js";

let exec: DbExec;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL_UNPOOLED", "pglite:memory://");
  exec = await bootDesignDatabase();
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

const asOwner = <T>(work: () => Promise<T>) =>
  runWithRequestContext({ userEmail: DESIGN_OWNER }, work);

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const screens = (count: number, size = 0) =>
  Array.from({ length: count }, (_, index) => ({
    filename: `screen-${String(index).padStart(2, "0")}.html`,
    content: `<main data-screen="${index}">${"x".repeat(size)}</main>`,
  }));

async function rows<T>(sql: string, args: unknown[] = []): Promise<T[]> {
  // raw-sql-ok: spec-only fixture queries with constant SQL text and bound args.
  return (await exec.execute({ sql, args: args as never[] })).rows as T[];
}

async function count(sql: string, args: unknown[]): Promise<number> {
  const row = firstRow(await rows<{ n: number | string }>(sql, args));
  return Number(row?.n);
}

const contentRows = (designId: string) =>
  count("SELECT COUNT(*) AS n FROM design_contents WHERE design_id = ?", [
    designId,
  ]);

const setContent = (fileId: string, content: string) =>
  exec.execute({
    sql: "UPDATE design_files SET content = ? WHERE id = ?",
    args: [content, fileId],
  });

const checkpoint = (designId: string, label = "Checkpoint") =>
  asOwner(() => createDesignVersionSnapshot(designId, { label }));

async function snapshotOf(designId: string, versionId: string) {
  const version = firstRow(
    await rows<{ snapshot: string }>(
      "SELECT snapshot FROM design_versions WHERE id = ?",
      [versionId],
    ),
  );
  if (!version) throw new Error(`No checkpoint ${versionId}`);
  return readDesignVersionSnapshot(version.snapshot, designId);
}

describe("design_files.content_hash", () => {
  it("is set on insert and follows every content update", async () => {
    await seedDesign(exec, "hash-design", [
      { filename: "index.html", content: "<p>one</p>" },
    ]);
    const hashOf = async () =>
      (
        await rows<{ content_hash: string }>(
          "SELECT content_hash FROM design_files WHERE id = ?",
          ["hash-design:index.html"],
        )
      )[0]?.content_hash;

    expect(await hashOf()).toBe(sha256("<p>one</p>"));
    await setContent("hash-design:index.html", "<p>ünïcode 😀</p>");
    expect(await hashOf()).toBe(sha256("<p>ünïcode 😀</p>"));
    await setContent("hash-design:index.html", "");
    expect(await hashOf()).toBe(sha256(""));
  });

  it("corrects a hash a writer supplies", async () => {
    await seedDesign(exec, "hash-forged", [
      { filename: "index.html", content: "<p>real</p>" },
    ]);
    await exec.execute({
      sql: "UPDATE design_files SET content_hash = ? WHERE id = ?",
      args: ["forged", "hash-forged:index.html"],
    });
    const row = firstRow(
      await rows<{ content_hash: string }>(
        "SELECT content_hash FROM design_files WHERE id = ?",
        ["hash-forged:index.html"],
      ),
    );
    expect(row?.content_hash).toBe(sha256("<p>real</p>"));
  });
});

describe("a checkpoint", () => {
  it("stores only the screen that changed since the last checkpoint", async () => {
    await seedDesign(exec, "one-screen", screens(30));
    await checkpoint("one-screen");
    const before = await contentRows("one-screen");

    await setContent("one-screen:screen-07.html", "<main>edited</main>");
    const second = await checkpoint("one-screen");

    expect(await contentRows("one-screen")).toBe(before + 1);
    const snapshot = await snapshotOf("one-screen", second.id);
    expect(snapshot.files).toHaveLength(30);
    expect(
      snapshot.files.find((file) => file.filename === "screen-07.html")
        ?.content,
    ).toBe("<main>edited</main>");
  });

  it("returns the previous checkpoint when nothing changed", async () => {
    await seedDesign(exec, "unchanged", screens(3));
    const first = await checkpoint("unchanged");
    const second = await checkpoint("unchanged");

    expect(second.id).toBe(first.id);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM design_versions WHERE design_id = ?",
        ["unchanged"],
      ),
    ).toBe(1);
  });

  it("gives a component delete its own retained checkpoint when nothing changed", async () => {
    await seedDesign(exec, "archive-own-row", screens(2));
    const first = await checkpoint("archive-own-row");
    const archive = await checkpoint(
      "archive-own-row",
      COMPONENT_DELETE_CHECKPOINT_LABEL,
    );
    const again = await checkpoint(
      "archive-own-row",
      COMPONENT_DELETE_CHECKPOINT_LABEL,
    );

    expect(archive.id).not.toBe(first.id);
    expect(again.id).toBe(archive.id);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM design_versions WHERE id = ? AND label = ?",
        [archive.id, COMPONENT_DELETE_CHECKPOINT_LABEL],
      ),
    ).toBe(1);
  });

  it("succeeds for a design over 256 KiB with no blob storage", async () => {
    await seedDesign(exec, "large", screens(12, 30_000));
    const version = await checkpoint("large");

    const snapshot = await snapshotOf("large", version.id);
    expect(snapshot.files).toHaveLength(12);
    expect(
      snapshot.files.reduce((total, file) => total + file.content.length, 0),
    ).toBeGreaterThan(256 * 1024);
  });

  it("captures collaborative text that SQL has not caught up with", async () => {
    await seedDesign(exec, "collab", [
      { filename: "index.html", content: "<main>stored</main>" },
    ]);
    await exec.execute({
      sql: `CREATE TABLE IF NOT EXISTS _collab_docs (
        doc_id TEXT PRIMARY KEY, yjs_state TEXT NOT NULL,
        text_snapshot TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (NOW()::text))`,
      args: [],
    });
    await exec.execute({
      sql: "INSERT INTO _collab_docs (doc_id, yjs_state, text_snapshot) VALUES (?, ?, ?)",
      args: ["collab:index.html", "state", "<main>live</main>"],
    });

    const version = await checkpoint("collab");

    const snapshot = await snapshotOf("collab", version.id);
    expect(snapshot.files[0]?.content).toBe("<main>live</main>");
    const entry = firstRow(
      await rows<{ source: string }>(
        "SELECT source FROM design_version_files WHERE version_id = ? AND entry_kind = 'file'",
        [version.id],
      ),
    );
    expect(entry?.source).toBe("collab");
    await exec.execute({
      sql: "DELETE FROM _collab_docs WHERE doc_id = ?",
      args: ["collab:index.html"],
    });
  });

  it("reads one screen without the rest of the design", async () => {
    await seedDesign(exec, "one-file", screens(3));
    const version = await checkpoint("one-file");

    const read = await readDesignVersionFile({
      designId: "one-file",
      versionId: version.id,
      fileId: "one-file:screen-01.html",
    });
    expect(read?.file?.content).toBe('<main data-screen="1"></main>');
    expect(
      await readDesignVersionFile({
        designId: "one-file",
        versionId: "missing",
        fileId: "one-file:screen-01.html",
      }),
    ).toBeNull();
  });

  it("refuses to read a checkpoint whose content was removed", async () => {
    await seedDesign(exec, "missing-content", screens(2));
    const version = await checkpoint("missing-content");
    await exec.execute({
      sql: "DELETE FROM design_contents WHERE design_id = ? AND hash = ?",
      args: ["missing-content", sha256('<main data-screen="0"></main>')],
    });

    await expect(snapshotOf("missing-content", version.id)).rejects.toThrow(
      "Design version content is missing.",
    );
  });
});

describe("when a checkpoint is taken", () => {
  const editor = (
    caller: "frontend" | "webmcp" | "mcp-widget-write",
  ): ActionRunContext => ({ caller, actionName: "update-file" });
  const beforeEdit = (designId: string, context: ActionRunContext) =>
    asOwner(() => snapshotDesignBeforeAgentEdit(designId, context));
  const versionCount = (designId: string) =>
    count("SELECT COUNT(*) AS n FROM design_versions WHERE design_id = ?", [
      designId,
    ]);

  it("requires editor access", async () => {
    await seedDesign(exec, "access", screens(1));
    await expect(
      runWithRequestContext({ userEmail: "stranger@example.com" }, () =>
        createDesignVersionSnapshot("access", { label: "Checkpoint" }),
      ),
    ).rejects.toThrow();
    expect(await versionCount("access")).toBe(0);
  });

  it("captures the start of a chat once per thread", async () => {
    await seedDesign(exec, "chat-start", screens(1));
    const run = { threadId: "thread-x", runId: "run-x" };
    const first = await asOwner(() =>
      createDesignChatBeginningSnapshot("chat-start", run),
    );
    await setContent("chat-start:screen-00.html", "<main>later</main>");
    const second = await asOwner(() =>
      createDesignChatBeginningSnapshot("chat-start", run),
    );

    expect(first?.label).toBe("Before chat");
    expect(second).toBeNull();
    expect(await versionCount("chat-start")).toBe(1);
  });

  it("records an edit that only changes design data", async () => {
    await seedDesign(exec, "tweak-only", screens(1));
    const first = await checkpoint("tweak-only");
    await exec.execute({
      sql: "UPDATE designs SET data = ? WHERE id = ?",
      args: [
        JSON.stringify({ tweakSelections: { color: "blue" } }),
        "tweak-only",
      ],
    });
    const second = await checkpoint("tweak-only");

    expect(second.id).not.toBe(first.id);
    const snapshot = await snapshotOf("tweak-only", second.id);
    expect(JSON.parse(snapshot.designData ?? "null")).toEqual({
      tweakSelections: { color: "blue" },
    });
  });

  it("treats deletion geometry as part of the checkpoint's identity", async () => {
    await seedDesign(exec, "geometry", screens(1));
    const deletionGeometry = {
      fileId: "geometry:screen-00.html",
      mainNodeId: "main-1",
      sourceVersionHash: "hash-1",
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
    };
    const plain = await checkpoint("geometry");
    const withGeometry = await asOwner(() =>
      createDesignVersionSnapshot("geometry", {
        label: "Before component delete",
        deletionGeometry,
      }),
    );
    const again = await asOwner(() =>
      createDesignVersionSnapshot("geometry", {
        label: "Before component delete",
        deletionGeometry,
      }),
    );

    expect(withGeometry.id).not.toBe(plain.id);
    expect(again.id).toBe(withGeometry.id);
    const read = await readDesignVersionFile({
      designId: "geometry",
      versionId: withGeometry.id,
      fileId: "geometry:screen-00.html",
    });
    expect(read?.deletionGeometry).toEqual(deletionGeometry);
  });

  it("keeps a new chat turn's own checkpoint when nothing changed", async () => {
    await seedDesign(exec, "turns", screens(1));
    const first = await beforeEdit("turns", agentToolContext("edit", "turn-a"));
    const second = await beforeEdit(
      "turns",
      agentToolContext("edit", "turn-b"),
    );

    expect(second?.id).not.toBe(first?.id);
    expect(await versionCount("turns")).toBe(2);
  });

  it("throttles browser saves for five minutes, even when content changed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-23T10:00:00.000Z"));
      await seedDesign(exec, "throttle", screens(1));
      const first = await beforeEdit("throttle", editor("frontend"));
      await setContent("throttle:screen-00.html", "<main>one</main>");
      vi.setSystemTime(new Date("2026-11-23T10:01:00.000Z"));
      const throttled = await beforeEdit(
        "throttle",
        editor("mcp-widget-write"),
      );
      expect(throttled?.id).toBe(first?.id);

      vi.setSystemTime(new Date("2026-11-23T10:06:00.000Z"));
      const later = await beforeEdit("throttle", editor("frontend"));
      expect(later?.id).not.toBe(first?.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not throttle agent-driven editor checkpoints or required ones", async () => {
    await seedDesign(exec, "unthrottled", screens(1));
    const browser = await beforeEdit("unthrottled", editor("frontend"));
    await setContent("unthrottled:screen-00.html", "<main>one</main>");
    const agent = await beforeEdit("unthrottled", editor("webmcp"));
    expect(agent?.id).not.toBe(browser?.id);

    await setContent("unthrottled:screen-00.html", "<main>two</main>");
    const afterAgent = await beforeEdit("unthrottled", editor("frontend"));
    expect(afterAgent?.id).not.toBe(agent?.id);

    await setContent("unthrottled:screen-00.html", "<main>three</main>");
    const required = await asOwner(() =>
      snapshotDesignBeforeAgentEditInVersionLock(
        "unthrottled",
        editor("frontend"),
      ),
    );
    expect(required?.id).not.toBe(afterAgent?.id);
  });
});

describe("restoring", () => {
  it("brings back edited, deleted and renamed screens and the title", async () => {
    await seedDesign(exec, "restore", screens(3));
    const version = await checkpoint("restore");

    await setContent("restore:screen-00.html", "<main>changed</main>");
    await exec.execute({
      sql: "DELETE FROM design_files WHERE id = ?",
      args: ["restore:screen-01.html"],
    });
    await exec.execute({
      sql: "UPDATE designs SET title = ? WHERE id = ?",
      args: ["Renamed", "restore"],
    });

    const result = await asOwner(() =>
      restoreDesignVersion({ designId: "restore", versionId: version.id }),
    );

    expect(result.restoredFileCount).toBe(3);
    const files = await rows<{ filename: string; content: string }>(
      "SELECT filename, content FROM design_files WHERE design_id = ? ORDER BY filename",
      ["restore"],
    );
    expect(files).toEqual(screens(3));
    const design = firstRow(
      await rows<{ title: string }>("SELECT title FROM designs WHERE id = ?", [
        "restore",
      ]),
    );
    expect(design?.title).toBe("Probe design");
  });

  it("saves the state it replaces as a Before restore checkpoint", async () => {
    await seedDesign(exec, "before-restore", screens(2));
    const version = await checkpoint("before-restore");
    await setContent("before-restore:screen-00.html", "<main>later</main>");

    const result = await asOwner(() =>
      restoreDesignVersion({
        designId: "before-restore",
        versionId: version.id,
      }),
    );

    const before = await snapshotOf(
      "before-restore",
      result.beforeRestoreVersionId,
    );
    expect(
      before.files.find((file) => file.filename === "screen-00.html")?.content,
    ).toBe("<main>later</main>");
  });

  it("keeps no Before restore checkpoint when the restore rolls back", async () => {
    await seedDesign(exec, "restore-conflict", [
      { filename: "a.html", content: "<main>a</main>" },
      { filename: "b.html", content: "<main>b</main>" },
    ]);
    await exec.execute({
      sql: "INSERT INTO design_versions (id, design_id, label, snapshot, file_count) VALUES (?, ?, ?, ?, ?)",
      args: [
        "conflicting-version",
        "restore-conflict",
        "Conflicting",
        JSON.stringify({
          designId: "restore-conflict",
          files: [
            {
              id: "restore-conflict:a.html",
              filename: "b.html",
              fileType: "html",
              content: "<main>x</main>",
            },
          ],
        }),
        1,
      ],
    });

    await expect(
      asOwner(() =>
        restoreDesignVersion({
          designId: "restore-conflict",
          versionId: "conflicting-version",
        }),
      ),
    ).rejects.toThrow("conflicting identity");
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM design_versions WHERE design_id = ? AND label = 'Before restore'",
        ["restore-conflict"],
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM design_version_files WHERE design_id = ?",
        ["restore-conflict"],
      ),
    ).toBe(0);
  });

  it("still restores a checkpoint stored as a full copy", async () => {
    await seedDesign(exec, "legacy", [
      { filename: "index.html", content: "<main>now</main>" },
    ]);
    await exec.execute({
      sql: "INSERT INTO design_versions (id, design_id, label, snapshot, file_count) VALUES (?, ?, ?, ?, ?)",
      args: [
        "legacy-version",
        "legacy",
        "Old",
        JSON.stringify({
          schemaVersion: 1,
          snapshotKind: "design-history",
          designId: "legacy",
          designTitle: "Old title",
          files: [
            {
              id: "legacy:index.html",
              filename: "index.html",
              fileType: "html",
              content: "<main>then</main>",
            },
          ],
        }),
        1,
      ],
    });

    await asOwner(() =>
      restoreDesignVersion({ designId: "legacy", versionId: "legacy-version" }),
    );

    const file = firstRow(
      await rows<{ content: string }>(
        "SELECT content FROM design_files WHERE id = ?",
        ["legacy:index.html"],
      ),
    );
    expect(file?.content).toBe("<main>then</main>");
  });
});

describe("retention", () => {
  it("keeps the newest 100 checkpoints and protected ones, and drops their unused content", async () => {
    await seedDesign(exec, "retention", [
      { filename: "index.html", content: "<main>v0</main>" },
    ]);
    const componentDelete = await asOwner(() =>
      createDesignVersionSnapshot("retention", {
        label: "Before component delete",
      }),
    );
    await setContent("retention:index.html", "<main>v-start</main>");
    const chatStart = await asOwner(() =>
      createDesignChatBeginningSnapshot("retention", {
        threadId: "older-thread",
        runId: "run",
      }),
    );
    for (let index = 1; index <= 110; index++) {
      await setContent("retention:index.html", `<main>v${index}</main>`);
      await asOwner(() =>
        createDesignVersionSnapshot("retention", {
          label: "Chat autosave",
          chatContext: {
            threadId: "later-thread",
            runId: "run",
            turnId: `turn-${index}`,
            phase: "end",
          },
        }),
      );
    }

    const versions = await rows<{ id: string }>(
      "SELECT id FROM design_versions WHERE design_id = ?",
      ["retention"],
    );
    const ids = new Set(versions.map((row) => row.id));
    expect(versions).toHaveLength(102);
    expect(ids.has(componentDelete.id)).toBe(true);
    expect(chatStart).not.toBeNull();
    expect(ids.has(chatStart?.id ?? "")).toBe(true);

    expect(
      await count(
        "SELECT COUNT(*) AS n FROM design_contents WHERE design_id = ? AND hash = ?",
        ["retention", sha256("<main>v5</main>")],
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM design_version_files m WHERE m.design_id = ? AND NOT EXISTS (SELECT 1 FROM design_versions v WHERE v.id = m.version_id)",
        ["retention"],
      ),
    ).toBe(0);
    for (const { id } of versions) {
      const snapshot = await snapshotOf("retention", id);
      expect(snapshot.files).toHaveLength(1);
    }
  });
});
