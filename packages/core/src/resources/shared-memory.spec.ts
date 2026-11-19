import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  deleteSharedPersonalMemory,
  isPersonalMemoryResourcePath,
  listSharedPersonalMemories,
  readSharedPersonalMemory,
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
    expect(isPersonalMemoryResourcePath("alice@example.com", "memory/MEMORY.md")).toBe(true);
    expect(isPersonalMemoryResourcePath("alice@example.com", "memory/wife-contact.md")).toBe(true);
    expect(isPersonalMemoryResourcePath("__shared__", "memory/MEMORY.md")).toBe(false);
    expect(isPersonalMemoryResourcePath("__organization__:org-1", "memory/MEMORY.md")).toBe(false);
    expect(isPersonalMemoryResourcePath("alice@example.com", "memory/../secret.md")).toBe(false);
    expect(isPersonalMemoryResourcePath("alice@example.com", "LEARNINGS.md")).toBe(false);
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

    const readIndex = await readSharedPersonalMemory(
      "alice@example.com",
      "memory/MEMORY.md",
    );
    expect(readIndex?.content).toContain("wife-contact.md");

    const readContact = await readSharedPersonalMemory(
      "alice@example.com",
      "memory/wife-contact.md",
    );
    expect(readContact?.content).toContain("wife@example.com");

    await deleteSharedPersonalMemory(
      "alice@example.com",
      "memory/wife-contact.md",
    );
    expect(
      await readSharedPersonalMemory("alice@example.com", "memory/wife-contact.md"),
    ).toBeNull();
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
    const { filterInitialEngineTools } = await import(
      "../agent/production-agent.js"
    );
    const tools = [
      { name: "resources", description: "", parameters: { type: "object", properties: {} } },
      { name: "save-memory", description: "", parameters: { type: "object", properties: {} } },
      { name: "delete-memory", description: "", parameters: { type: "object", properties: {} } },
      { name: "other-deferred-tool", description: "", parameters: { type: "object", properties: {} } },
    ] as any;
    const initial = filterInitialEngineTools(tools, []);
    expect(initial.map((t) => t.name)).toEqual([
      "resources",
      "save-memory",
      "delete-memory",
    ]);
  });
});
