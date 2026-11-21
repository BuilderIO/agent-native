import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteSharedPersonalMemory,
  removeTombstonedSharedFile,
  isPersonalMemoryResourcePath,
  listSharedPersonalMemories,
  MemoryLockTimeoutError,
  MemoryTombstoneError,
  MemoryMirrorStaleError,
  readAbandonedMemoryDelete,
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
      Date.now(),
    );
    await writeSharedPersonalMemory(
      "alice@example.com",
      "memory/wife-contact.md",
      "Wife's email is wife@example.com.\n",
      Date.now(),
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
    await writeSharedPersonalMemory(
      "alice@example.com",
      "memory/t.md",
      "x",
      Date.now(),
    );
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

  it("reports a leftover file when the quarantined file cannot be removed either", async () => {
    const dir = makeTempDir();
    process.env.AGENT_NATIVE_MEMORY_DIR = dir;
    await writeSharedPersonalMemory(
      "alice@example.com",
      "memory/stuck.md",
      "x",
      Date.now(),
    );
    const realUnlink = fs.promises.unlink.bind(fs.promises);
    const unlink = vi
      .spyOn(fs.promises, "unlink")
      .mockImplementation(async (target) => {
        const name = String(target);
        if (name.endsWith("stuck.md") || name.endsWith(".removed")) {
          throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
        }
        await realUnlink(target);
      });
    try {
      await expect(
        deleteSharedPersonalMemory("alice@example.com", "memory/stuck.md"),
      ).rejects.toBeInstanceOf(MemoryMirrorStaleError);
    } finally {
      unlink.mockRestore();
    }
  });

  it("removes a tombstoned leftover file on retry and leaves live files alone", async () => {
    const dir = makeTempDir();
    process.env.AGENT_NATIVE_MEMORY_DIR = dir;
    const owner = "alice@example.com";
    const resourcePath = "memory/leftover.md";
    const filePath = resolveSharedMemoryFilePath(dir, owner, resourcePath);
    if (!filePath) throw new Error("unresolved memory path");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "stale");
    const mtime = Math.floor(fs.statSync(filePath).mtimeMs);
    fs.writeFileSync(`${filePath}.deleted`, String(mtime + 1000));
    expect(await removeTombstonedSharedFile(owner, resourcePath)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(await removeTombstonedSharedFile(owner, resourcePath)).toBe(false);
    fs.writeFileSync(filePath, "live");
    fs.writeFileSync(`${filePath}.deleted`, String(mtime - 5000));
    expect(await removeTombstonedSharedFile(owner, resourcePath)).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("stamps a mirrored file with the revision it was written for", async () => {
    const dir = makeTempDir();
    process.env.AGENT_NATIVE_MEMORY_DIR = dir;
    const revision = Date.now() - 3_600_000;
    await writeSharedPersonalMemory(
      "alice@example.com",
      "memory/stamp.md",
      "x",
      revision,
    );
    const file = resolveSharedMemoryFilePath(
      dir,
      "alice@example.com",
      "memory/stamp.md",
    ) as string;
    expect(Math.ceil(fs.statSync(file).mtimeMs)).toBe(revision);
  });

  describe("per-path lock", () => {
    const owner = "alice@example.com";
    const setup = (name: string) => {
      const dir = makeTempDir();
      process.env.AGENT_NATIVE_MEMORY_DIR = dir;
      const file = resolveSharedMemoryFilePath(
        dir,
        owner,
        `memory/${name}.md`,
      ) as string;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      return file;
    };

    it("keeps the highest floor when two deletes publish at once", async () => {
      const file = setup("race");
      const high = Date.now() + 3_600_000;
      await Promise.all([
        deleteSharedPersonalMemory(owner, "memory/race.md", high),
        deleteSharedPersonalMemory(owner, "memory/race.md", 5),
      ]);
      expect(Number(fs.readFileSync(`${file}.deleted`, "utf8"))).toBe(high);
    });

    it("never lets a concurrent writer leave a file or clear a newer tombstone", async () => {
      const file = setup("clear");
      const high = Date.now() + 3_600_000;
      await Promise.allSettled([
        writeSharedPersonalMemory(owner, "memory/clear.md", "x", high - 1),
        deleteSharedPersonalMemory(owner, "memory/clear.md", high),
      ]);
      expect(Number(fs.readFileSync(`${file}.deleted`, "utf8"))).toBe(high);
      await expect(
        readMirroredMemory(owner, "memory/clear.md"),
      ).resolves.toMatchObject({ state: "deleted" });
    });

    it("waits for a live holder and then proceeds", async () => {
      const file = setup("held");
      fs.writeFileSync(`${file}.lock`, `${process.pid} ${Date.now()}`);
      const writing = writeSharedPersonalMemory(
        owner,
        "memory/held.md",
        "x",
        Date.now(),
      );
      // fixed-sleep-ok: proves the writer is still blocked while the lock is held.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(fs.existsSync(file)).toBe(false);
      fs.unlinkSync(`${file}.lock`);
      await writing;
      expect(fs.readFileSync(file, "utf8")).toBe("x");
      expect(fs.existsSync(`${file}.lock`)).toBe(false);
    });

    it("breaks a stale lock whose process is dead", async () => {
      const file = setup("stale");
      const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
      fs.writeFileSync(`${file}.lock`, `${dead} 1`);
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(`${file}.lock`, old, old);
      await writeSharedPersonalMemory(
        owner,
        "memory/stale.md",
        "x",
        Date.now(),
      );
      expect(fs.readFileSync(file, "utf8")).toBe("x");
    });

    it("does not break a fresh lock and times out with a typed error", async () => {
      const file = setup("busy");
      fs.writeFileSync(`${file}.lock`, `${process.pid} ${Date.now()}`);
      await expect(
        writeSharedPersonalMemory(owner, "memory/busy.md", "x", Date.now()),
      ).rejects.toBeInstanceOf(MemoryLockTimeoutError);
      expect(fs.existsSync(`${file}.lock`)).toBe(true);
      expect(fs.existsSync(file)).toBe(false);
    });

    it("does not unlink a lock that a rival replaced after it was judged stale", async () => {
      const file = setup("rival");
      const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
      fs.writeFileSync(`${file}.lock`, `${dead} 1`);
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(`${file}.lock`, old, old);
      const realOpen = fs.promises.open.bind(fs.promises);
      const open = vi
        .spyOn(fs.promises, "open")
        .mockImplementation(async (target, ...rest) => {
          if (String(target) === `${file}.lock.reclaim`) {
            fs.unlinkSync(`${file}.lock`);
            fs.writeFileSync(`${file}.lock`, `${process.pid} ${Date.now()}`);
          }
          return (realOpen as (...a: unknown[]) => Promise<never>)(
            target,
            ...rest,
          );
        });
      try {
        await expect(
          writeSharedPersonalMemory(owner, "memory/rival.md", "x", Date.now()),
        ).rejects.toBeInstanceOf(MemoryLockTimeoutError);
      } finally {
        open.mockRestore();
      }
      expect(fs.readFileSync(`${file}.lock`, "utf8")).toMatch(
        new RegExp(`^${process.pid} `),
      );
      expect(fs.existsSync(`${file}.lock.reclaim`)).toBe(false);
    });

    it("never breaks a held reclaim lock", async () => {
      const file = setup("reclaim");
      const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
      fs.writeFileSync(`${file}.lock`, `${dead} 1`);
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(`${file}.lock`, old, old);
      fs.writeFileSync(`${file}.lock.reclaim`, "");
      await expect(
        writeSharedPersonalMemory(owner, "memory/reclaim.md", "x", Date.now()),
      ).rejects.toBeInstanceOf(MemoryLockTimeoutError);
      expect(fs.existsSync(`${file}.lock.reclaim`)).toBe(true);
    });

    it("recovers a reclaim marker stranded by a crashed reclaimer", async () => {
      const file = setup("crashed-reclaimer");
      const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
      const old = new Date(Date.now() - 60_000);
      for (const name of [".lock", ".lock.reclaim"]) {
        fs.writeFileSync(`${file}${name}`, `${dead} 1`);
        fs.utimesSync(`${file}${name}`, old, old);
      }
      await writeSharedPersonalMemory(
        owner,
        "memory/crashed-reclaimer.md",
        "x",
        Date.now(),
      );
      expect(fs.readFileSync(file, "utf8")).toBe("x");
      expect(fs.readdirSync(path.dirname(file))).toEqual([path.basename(file)]);
    });

    it("keeps an old reclaim marker whose process is alive", async () => {
      const file = setup("live-reclaimer");
      const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
      const old = new Date(Date.now() - 60_000);
      fs.writeFileSync(`${file}.lock`, `${dead} 1`);
      fs.writeFileSync(`${file}.lock.reclaim`, `${process.pid} 1`);
      for (const name of [".lock", ".lock.reclaim"]) {
        fs.utimesSync(`${file}${name}`, old, old);
      }
      await expect(
        writeSharedPersonalMemory(
          owner,
          "memory/live-reclaimer.md",
          "x",
          Date.now(),
        ),
      ).rejects.toBeInstanceOf(MemoryLockTimeoutError);
      expect(fs.existsSync(`${file}.lock.reclaim`)).toBe(true);
    });

    it("does not break an old lock whose process is still alive", async () => {
      const file = setup("alive");
      fs.writeFileSync(`${file}.lock`, `${process.pid} 1`);
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(`${file}.lock`, old, old);
      await expect(
        writeSharedPersonalMemory(owner, "memory/alive.md", "x", Date.now()),
      ).rejects.toBeInstanceOf(MemoryLockTimeoutError);
    });
  });

  it("reads a pending tombstone as a delete and only abandons it once its process is gone", async () => {
    const dir = makeTempDir();
    process.env.AGENT_NATIVE_MEMORY_DIR = dir;
    const file = resolveSharedMemoryFilePath(
      dir,
      "alice@example.com",
      "memory/p.md",
    ) as string;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
    const write = (pid: number | undefined, state = "pending") =>
      fs.writeFileSync(
        `${file}.deleted`,
        JSON.stringify({ deletedAt: 5, state, pid }),
      );
    write(process.pid);
    await expect(
      readMirroredMemory("alice@example.com", "memory/p.md"),
    ).resolves.toEqual({ state: "deleted", deletedAt: 5 });
    await expect(
      readAbandonedMemoryDelete("alice@example.com", "memory/p.md"),
    ).resolves.toBeNull();
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(`${file}.deleted`, old, old);
    await expect(
      readAbandonedMemoryDelete("alice@example.com", "memory/p.md"),
    ).resolves.toBeNull();
    write(dead);
    await expect(
      readAbandonedMemoryDelete("alice@example.com", "memory/p.md"),
    ).resolves.toBe(5);
    write(dead, "committed");
    await expect(
      readAbandonedMemoryDelete("alice@example.com", "memory/p.md"),
    ).resolves.toBeNull();
    fs.writeFileSync(`${file}.deleted`, "5");
    await expect(
      readAbandonedMemoryDelete("alice@example.com", "memory/p.md"),
    ).resolves.toBeNull();
  });

  it("reads content and revision from one file handle", async () => {
    const dir = makeTempDir();
    process.env.AGENT_NATIVE_MEMORY_DIR = dir;
    const owner = "alice@example.com";
    await writeSharedPersonalMemory(owner, "memory/one.md", "first", 1_000_000);
    const file = resolveSharedMemoryFilePath(
      dir,
      owner,
      "memory/one.md",
    ) as string;
    const realOpen = fs.promises.open.bind(fs.promises);
    const open = vi
      .spyOn(fs.promises, "open")
      .mockImplementation(async (target, ...rest) => {
        const handle = await (realOpen as (...a: unknown[]) => Promise<never>)(
          target,
          ...rest,
        );
        if (String(target) === file) {
          await writeSharedPersonalMemory(
            owner,
            "memory/one.md",
            "second",
            2_000_000,
          );
        }
        return handle;
      });
    try {
      const read = await readMirroredMemory(owner, "memory/one.md");
      expect(read).toMatchObject({ state: "present", content: "first" });
      expect(read.state === "present" && read.mtimeMs).toBe(1_000_000);
    } finally {
      open.mockRestore();
    }
  });

  it("publishes a tombstone by renaming a temp file, never in place", async () => {
    const dir = makeTempDir();
    process.env.AGENT_NATIVE_MEMORY_DIR = dir;
    await writeSharedPersonalMemory(
      "alice@example.com",
      "memory/n.md",
      "x",
      Date.now(),
    );
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
    await writeSharedPersonalMemory(
      "alice@example.com",
      "memory/a.md",
      "x",
      Date.now(),
    );
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
    await writeSharedPersonalMemory(
      "alice@example.com",
      "memory/f.md",
      "x",
      Date.now(),
    );
    const file = resolveSharedMemoryFilePath(
      dir,
      "alice@example.com",
      "memory/f.md",
    ) as string;
    const future = Date.now() + 3_600_000;
    fs.utimesSync(file, future / 1000, future / 1000);
    const mtime = Math.floor(fs.statSync(file).mtimeMs);
    await deleteSharedPersonalMemory("alice@example.com", "memory/f.md");
    expect(Number(fs.readFileSync(`${file}.deleted`, "utf8"))).toBeGreaterThan(
      mtime,
    );

    await writeSharedPersonalMemory(
      "alice@example.com",
      "memory/g.md",
      "x",
      Date.now(),
    );
    const floor = Date.now() + 7_200_000;
    await deleteSharedPersonalMemory("alice@example.com", "memory/g.md", floor);
    const tomb = resolveSharedMemoryFilePath(
      dir,
      "alice@example.com",
      "memory/g.md",
    );
    expect(Number(fs.readFileSync(`${tomb}.deleted`, "utf8"))).toBe(floor);
  });

  it("refuses a delayed mirror older than a delete and keeps the tombstone", async () => {
    const dir = makeTempDir();
    process.env.AGENT_NATIVE_MEMORY_DIR = dir;
    const revision = Date.now();
    await writeSharedPersonalMemory(
      "alice@example.com",
      "memory/d.md",
      "x",
      revision,
    );
    await deleteSharedPersonalMemory(
      "alice@example.com",
      "memory/d.md",
      revision + 10,
    );
    const file = resolveSharedMemoryFilePath(
      dir,
      "alice@example.com",
      "memory/d.md",
    ) as string;

    await expect(
      writeSharedPersonalMemory(
        "alice@example.com",
        "memory/d.md",
        "late",
        revision,
      ),
    ).rejects.toBeInstanceOf(MemoryTombstoneError);
    expect(fs.existsSync(`${file}.deleted`)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);

    await writeSharedPersonalMemory(
      "alice@example.com",
      "memory/d.md",
      "newer",
      Date.now() + 60_000,
    );
    expect(fs.existsSync(`${file}.deleted`)).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("newer");
  });

  it("never lowers an existing tombstone and fails closed on an unreadable one", async () => {
    const dir = makeTempDir();
    process.env.AGENT_NATIVE_MEMORY_DIR = dir;
    const high = Date.now() + 7_200_000;
    await deleteSharedPersonalMemory("alice@example.com", "memory/m.md", high);
    expect(
      await deleteSharedPersonalMemory("alice@example.com", "memory/m.md", 1),
    ).toBe(high);
    const marker = `${resolveSharedMemoryFilePath(dir, "alice@example.com", "memory/m.md")}.deleted`;
    expect(Number(fs.readFileSync(marker, "utf8"))).toBe(high);

    fs.writeFileSync(marker, "garbage");
    await expect(
      deleteSharedPersonalMemory("alice@example.com", "memory/m.md", 1),
    ).rejects.toBeInstanceOf(MemoryTombstoneError);
    expect(fs.readFileSync(marker, "utf8")).toBe("garbage");
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
