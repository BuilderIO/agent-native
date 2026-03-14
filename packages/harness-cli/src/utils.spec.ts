import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  snapshotDataDir,
  diffSnapshots,
  buildCliArgs,
  withChatLock,
  ASYNC_SYSTEM_PROMPT,
} from "./utils.js";

describe("snapshotDataDir", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty object for non-existent directory", () => {
    expect(snapshotDataDir(path.join(tmpDir, "nope"))).toEqual({});
  });

  it("captures file mtimes", () => {
    fs.writeFileSync(path.join(tmpDir, "a.json"), "{}");
    const snap = snapshotDataDir(tmpDir);
    const keys = Object.keys(snap);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe(path.join(tmpDir, "a.json"));
    expect(typeof snap[keys[0]]).toBe("number");
  });

  it("walks nested directories", () => {
    fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "top.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "sub", "deep.json"), "{}");
    const snap = snapshotDataDir(tmpDir);
    expect(Object.keys(snap)).toHaveLength(2);
    expect(snap[path.join(tmpDir, "top.json")]).toBeDefined();
    expect(snap[path.join(tmpDir, "sub", "deep.json")]).toBeDefined();
  });
});

describe("diffSnapshots", () => {
  const dataDir = "/data";

  it("detects new files", () => {
    const before = {};
    const after = { "/data/new.json": 1000 };
    expect(diffSnapshots(before, after, dataDir)).toEqual(["new.json"]);
  });

  it("detects modified files", () => {
    const before = { "/data/a.json": 1000 };
    const after = { "/data/a.json": 2000 };
    expect(diffSnapshots(before, after, dataDir)).toEqual(["a.json"]);
  });

  it("detects deleted files", () => {
    const before = { "/data/gone.json": 1000 };
    const after = {};
    expect(diffSnapshots(before, after, dataDir)).toEqual(["gone.json"]);
  });

  it("returns empty array when nothing changed", () => {
    const snap = { "/data/a.json": 1000 };
    expect(diffSnapshots(snap, snap, dataDir)).toEqual([]);
  });

  it("reports all types of changes together", () => {
    const before = {
      "/data/same.json": 1000,
      "/data/mod.json": 1000,
      "/data/del.json": 1000,
    };
    const after = {
      "/data/same.json": 1000,
      "/data/mod.json": 2000,
      "/data/new.json": 1000,
    };
    const result = diffSnapshots(before, after, dataDir);
    expect(result).toContain("mod.json");
    expect(result).toContain("new.json");
    expect(result).toContain("del.json");
    expect(result).not.toContain("same.json");
  });
});

describe("buildCliArgs", () => {
  it("builds claude args with --print and system prompt", () => {
    const args = buildCliArgs("claude", "hello");
    expect(args).toEqual([
      "--print",
      "--append-system-prompt",
      ASYNC_SYSTEM_PROMPT,
      "hello",
    ]);
  });

  it("appends context to system prompt for claude", () => {
    const args = buildCliArgs("claude", "hello", "extra context");
    expect(args[2]).toContain(ASYNC_SYSTEM_PROMPT);
    expect(args[2]).toContain("Additional context:\nextra context");
  });

  it("builds codex args", () => {
    const args = buildCliArgs("codex", "hello");
    expect(args).toEqual(["--quiet", "--full-stdout", "hello"]);
  });

  it("builds gemini args", () => {
    const args = buildCliArgs("gemini", "hello");
    expect(args).toEqual(["--prompt", "hello"]);
  });

  it("uses message-only for unknown commands", () => {
    const args = buildCliArgs("unknown-cli", "hello");
    expect(args).toEqual(["hello"]);
  });
});

describe("withChatLock", () => {
  it("serializes concurrent calls", async () => {
    const order: number[] = [];

    const p1 = withChatLock(async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
      return 1;
    });

    const p2 = withChatLock(async () => {
      order.push(2);
      return 2;
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(order).toEqual([1, 2]);
  });

  it("continues after a failed call", async () => {
    const p1 = withChatLock(async () => {
      throw new Error("boom");
    });
    await expect(p1).rejects.toThrow("boom");

    const p2 = withChatLock(async () => "ok");
    await expect(p2).resolves.toBe("ok");
  });
});
