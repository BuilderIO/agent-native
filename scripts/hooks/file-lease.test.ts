import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("./file-lease.mjs", import.meta.url));

function runHook(root: string, session: string, event: string) {
  const target = path.join(root, "target.txt");
  const input = JSON.stringify({
    session_id: session,
    hook_event_name: event,
    tool_input: { file_path: target },
  });
  const result = spawnSync(process.execPath, [HOOK], {
    input,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  const decision = result.stdout
    ? JSON.parse(result.stdout)?.hookSpecificOutput?.permissionDecision
    : "allow";
  return { decision, target };
}

describe("file-lease hook", () => {
  it("allows a session's own first write and re-write", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "file-lease-basic-"));
    try {
      writeFileSync(path.join(root, "target.txt"), "v1");
      assert.equal(runHook(root, "session-a", "PreToolUse").decision, "allow");
      runHook(root, "session-a", "PostToolUse");
      assert.equal(runHook(root, "session-a", "PreToolUse").decision, "allow");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("denies a different live session editing a leased file", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "file-lease-collide-"));
    try {
      writeFileSync(path.join(root, "target.txt"), "v1");
      runHook(root, "session-a", "PreToolUse");
      runHook(root, "session-a", "PostToolUse");
      assert.equal(runHook(root, "session-b", "PreToolUse").decision, "deny");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("denies a stale write that would resurrect a peer-deleted file", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "file-lease-delete-"));
    try {
      const target = path.join(root, "target.txt");
      writeFileSync(target, "v1");
      runHook(root, "session-a", "PreToolUse");
      runHook(root, "session-a", "PostToolUse");

      unlinkSync(target);

      const first = runHook(root, "session-a", "PreToolUse");
      assert.equal(first.decision, "deny");

      writeFileSync(target, "v2");
      assert.equal(runHook(root, "session-a", "PreToolUse").decision, "allow");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates the lease directory on first use", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "file-lease-mkdir-"));
    try {
      writeFileSync(path.join(root, "target.txt"), "v1");
      assert.equal(runHook(root, "session-a", "PreToolUse").decision, "allow");
      mkdirSync(path.join(root, ".claude", "leases"), { recursive: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
