import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  listSharedPersonalMemories,
  readMirroredMemory,
  writeSharedPersonalMemory,
} from "./shared-memory.js";

const prev = process.env.AGENT_NATIVE_MEMORY_DIR;
const dirs: string[] = [];

afterEach(() => {
  if (prev === undefined) delete process.env.AGENT_NATIVE_MEMORY_DIR;
  else process.env.AGENT_NATIVE_MEMORY_DIR = prev;
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("cross-chat memory recall", () => {
  it("a recipient email remembered in one chat is readable in a new chat for a Mail draft", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-recall-"));
    dirs.push(dir);
    process.env.AGENT_NATIVE_MEMORY_DIR = dir;
    const owner = "steve@example.test";

    await writeSharedPersonalMemory(
      owner,
      "memory/wife-contact.md",
      "My wife's email is wife@example.test\n",
      Date.now(),
    );

    const read = await readMirroredMemory(owner, "memory/wife-contact.md");
    expect(read).toMatchObject({
      state: "present",
      content: expect.stringContaining("wife@example.test"),
    });
    const listed = await listSharedPersonalMemories(owner);
    expect(listed.map((m) => m.path)).toContain("memory/wife-contact.md");
  });
});
