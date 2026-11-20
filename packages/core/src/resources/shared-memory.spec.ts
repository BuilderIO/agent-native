import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteSharedPersonalMemory,
  isPersonalMemoryResourcePath,
  listSharedPersonalMemories,
  MemoryTombstoneError,
  MemoryMirrorStaleError,
  readMirroredMemory,
  staleMirrorCollector,
  resolveSharedMemoryFilePath,
  writeSharedPersonalMemory,
} from "./shared-memory.js";

const tempDirs: string[] = [];
const prevMemoryDir = process.env.AGENT_NATIVE_MEMORY_DIR;

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-shared-memory-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  if (prevMemoryDir === undefined) {
    delete process.env.AGENT_NATIVE_MEMORY_DIR;
  } else {
    process.env.AGENT_NATIVE_MEMORY_DIR = prevMemoryDir;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("shared-memory", () => {
  it("accepts only personal memory markdown paths", () => {
    expect(
      isPersonalMemoryResourcePath("alice@example.com", "memory/MEMORY.md"),
    ).toBe(true);
    expect(
      isPersonalMemoryResourcePath(
        "alice@example.com",
        "memory/wife-contact.md",
      ),
    ).toBe(true);
    expect(isPersonalMemoryResourcePath("__shared__", "memory/MEMORY.md")).toBe(
      false,
    );
    expect(
      isPersonalMemoryResourcePath(
        "__organization__:org-1",
        "memory/MEMORY.md",
      ),
    ).toBe(false);
    expect(
      isPersonalMemoryResourcePath("alice@example.com", "memory/../secret.md"),
    ).toBe(false);
    expect(
      isPersonalMemoryResourcePath("alice@example.com", "LEARNINGS.md"),
    ).toBe(false);
  });

  it("writes, lists, reads, and deletes shared personal memories across apps", async () => {
    const dir = makeTempDir();
    process.env.AGENT_NATIVE_MEMORY_DIR = dir;

    await writeSharedPersonalMemory(
      "alice@example.com",
      "memory/MEMORY.md",
      "# Memory Index\n- [wife-contact](wife-contact.md) — Wife's email address\n",
    );
    await writeSharedPersonalMemory(
      "alice@example.com",
      "memory/wife-contact.md",
      "Wife's email is wife@example.com.\n",
    );

    const listed = await listSharedPersonalMemories("alice@example.com");
    expect(listed.map((item) => item.path).sort()).toEqual([
      "memory/MEMORY.md",
      "memory/wife-contact.md",
    ]);

    const readIndex = await readMirroredMemory(
      "alice@example.com",
      "memory/MEMORY.md",
    );
    expect(readIndex).toMatchObject({
      state: "present",
      content: expect.stringContaining("wife-contact.md"),
    });

    const readContact = await readMirroredMemory(
      "alice@example.com",
      "memory/wife-contact.md",
    );
    expect(readContact).toMatchObject({
      state: "present",
      content: expect.stringContaining("wife@example.com"),
    });

    await deleteSharedPersonalMemory(
      "alice@example.com",
      "memory/wife-contact.md",
    );
    expect(
      await readMirroredMemory("alice@example.com", "memory/wife-contact.md"),
    ).toEqual({ state: "deleted", deletedAt: expect.any(Number) });
  });

  it("rejects traversal paths", () => {
    const dir = makeTempDir();
    expect(
      resolveSharedMemoryFilePath(dir, "alice@example.com", "memory/../x.md"),
    ).toBeNull();
    expect(
      resolveSharedMemoryFilePath(dir, "__shared__", "memory/MEMORY.md"),
    ).toBeNull();
  });

  it("includes save-memory and delete-memory in default initial tools", async () => {
    const { filterInitialEngineTools } =
      await import("../agent/production-agent.js");
    const tools = [
      {
        name: "resources",
        description: "",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "save-memory",
        description: "",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "delete-memory",
        description: "",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "other-deferred-tool",
        description: "",
        parameters: { type: "object", properties: {} },
      },
    ] as Parameters<typeof filterInitialEngineTools>[0];
    const initial = filterInitialEngineTools(tools, []);
    expect(initial.map((t) => t.name)).toEqual([
      "resources",
      "save-memory",
      "delete-memory",
    ]);
  });

  it("rejects an empty or non-numeric tombstone instead of reading it as 0", async () => {
    const dir = makeTempDir();
    process.env.AGENT_NATIVE_MEMORY_DIR = dir;
    await writeSharedPersonalMemory("alice@example.com", "memory/t.md", "x");
    const file = resolveSharedMemoryFilePath(
      dir,
      "alice@example.com",
      "memory/t.md",
    );
    for (const text of [
      "",
      "  ",
      "abc",
      "-5",
      "1.5",
      "9".repeat(400),
      "9007199254740993",
    ]) {
      fs.writeFileSync(`${file}.deleted`, text);
      await expect(
        readMirroredMemory("alice@example.com", "memory/t.md"),
      ).rejects.toBeInstanceOf(MemoryTombstoneError);
    }
  });

  it("publishes a tombstone by renaming a temp file, never in place", async () => {
    const dir = makeTempDir();
    process.env.AGENT_NATIVE_MEMORY_DIR = dir;
    await writeSharedPersonalMemory("alice@example.com", "memory/n.md", "x");
    const rename = vi.spyOn(fs.promises, "rename");
    try {
      await deleteSharedPersonalMemory("alice@example.com", "memory/n.md");
      const tombstone = rename.mock.calls.find(([, to]) =>
        String(to).endsWith("n.md.deleted"),
      );
      expect(tombstone).toBeDefined();
      expect(String(tombstone?.[0])).toMatch(/n\.md\.deleted\..+\.tmp$/);
    } finally {
      rename.mockRestore();
    }
  });

  it("writes tombstones atomically and keeps tied files deleted", async () => {
    const dir = makeTempDir();
    process.env.AGENT_NATIVE_MEMORY_DIR = dir;
    await writeSharedPersonalMemory("alice@example.com", "memory/a.md", "x");
    await deleteSharedPersonalMemory("alice@example.com", "memory/a.md");
    const ownerDir = path.join(dir, encodeURIComponent("alice@example.com"));
    expect(fs.readdirSync(ownerDir)).toEqual(["a.md.deleted"]);

    fs.writeFileSync(path.join(ownerDir, "a.md"), "survivor");
    const tombstone = path.join(ownerDir, "a.md.deleted");
    const at = fs.statSync(path.join(ownerDir, "a.md")).mtimeMs;
    fs.writeFileSync(tombstone, String(Math.ceil(at)));
    await expect(
      readMirroredMemory("alice@example.com", "memory/a.md"),
    ).resolves.toMatchObject({ state: "deleted" });
  });

  it("stamps a tombstone above the surviving file's mtime and the revision floor", async () => {
    const dir = makeTempDir();
    process.env.AGENT_NATIVE_MEMORY_DIR = dir;
    await writeSharedPersonalMemory("alice@example.com", "memory/f.md", "x");
    const file = resolveSharedMemoryFilePath(
      dir,
      "alice@example.com",
      "memory/f.md",
    ) as string;
    const future = Date.now() + 3_600_000;
    fs.utimesSync(file, future / 1000, future / 1000);
    await deleteSharedPersonalMemory("alice@example.com", "memory/f.md");
    expect(Number(fs.readFileSync(`${file}.deleted`, "utf8"))).toBeGreaterThan(
      future,
    );

    await writeSharedPersonalMemory("alice@example.com", "memory/g.md", "x");
    const floor = Date.now() + 7_200_000;
    await deleteSharedPersonalMemory("alice@example.com", "memory/g.md", floor);
    const tomb = resolveSharedMemoryFilePath(
      dir,
      "alice@example.com",
      "memory/g.md",
    );
    expect(Number(fs.readFileSync(`${tomb}.deleted`, "utf8"))).toBe(floor);
  });

  it("keeps the first stale-mirror error for the end and rethrows anything else at once", () => {
    const collector = staleMirrorCollector();
    const stale = new MemoryMirrorStaleError("stale", {
      path: "memory/a.md",
      content: "",
      updatedAt: 1,
    });
    collector.absorb(stale);
    expect(() => collector.absorb(new Error("boom"))).toThrow("boom");
    expect(() => collector.finish()).toThrow(stale);
  });
});
