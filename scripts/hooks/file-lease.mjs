#!/usr/bin/env node
/**
 * file-lease.mjs — PreToolUse(Edit|Write|MultiEdit|NotebookEdit)
 *
 * Many agents share one checkout by design. Today they discover collisions
 * only after a diff quietly vanishes: "another agent landed its OWN complete
 * fix for the exact same bug in the exact same file, overwriting my in-progress
 * edits on disk". The inverse is just as costly — a false "you reverted my
 * work" accusation burns a whole investigation round.
 *
 * Two checks, both cheap:
 *   1. Another live session (lease newer than LEASE_TTL_MS) holds this file →
 *      deny and name the holder, so the agents coordinate instead of racing.
 *   2. The file changed on disk since THIS session last wrote it → deny, so a
 *      peer's landed edit is never silently overwritten by a stale buffer.
 *
 * Leases live in .claude/leases/ (gitignored) and are just a timestamp plus
 * the session id; a crashed session's lease expires on its own.
 */

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const LEASE_TTL_MS = 15 * 60 * 1000;
const SWEEP_AFTER_MS = 60 * 60 * 1000;

const input = readStdin();
const session = String(input.session_id ?? "");
const file = String(
  input?.tool_input?.file_path ?? input?.tool_input?.notebook_path ?? "",
);
if (!session || !file) allow();

const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const leaseDir = path.join(root, ".claude", "leases");
const leasePath = path.join(
  leaseDir,
  `${createHash("sha1").update(path.resolve(file)).digest("hex")}.json`,
);

const now = Date.now();
const diskMtime = mtimeOf(file);

// PostToolUse re-stamps the lease with the mtime our own write just produced.
// Without that, our next edit to the same file would look like a peer's change.
if (input.hook_event_name === "PostToolUse") {
  writeLease();
  allow();
}

const previous = readLease(leasePath);

if (
  previous &&
  previous.session !== session &&
  now - previous.at < LEASE_TTL_MS
) {
  deny(
    `Another agent session (\`${previous.session.slice(0, 8)}\`) claimed ` +
      `${show(file)} ${Math.round((now - previous.at) / 1000)}s ago ` +
      `and may have unsaved reasoning about it.\n\n` +
      `Do not overwrite it. Either work on a different file, or — if this edit ` +
      `genuinely belongs to you — re-read the file first so you are editing its ` +
      `current contents, and say in your response that you are taking over a ` +
      `file another session was holding.\n\n` +
      `The lease expires on its own after 15 minutes of inactivity.`,
  );
}

if (
  previous &&
  previous.session === session &&
  diskMtime !== null &&
  previous.mtime !== null &&
  diskMtime > previous.mtime
) {
  // Record the mtime we just objected to BEFORE denying, so this fires once
  // and the retry proceeds. Re-reading a file runs no hook, so without this
  // the lease keeps its stale mtime, every retry compares against it, and the
  // file is wedged for the full lease TTL — the deny becomes unsatisfiable
  // rather than informative.
  writeLease();
  deny(
    `${show(file)} changed on disk since you last wrote it — ` +
      `another agent edited it while you were working.\n\n` +
      `Re-read the file before editing so you build on their change instead of ` +
      `reverting it. Losing a peer's landed work this way is the exact failure ` +
      `this check exists to prevent. Re-running this edit after re-reading will ` +
      `proceed.`,
  );
}

writeLease();
allow();

function writeLease() {
  try {
    mkdirSync(leaseDir, { recursive: true });
    sweep();
    writeFileSync(
      leasePath,
      JSON.stringify({ session, at: now, mtime: diskMtime, file }),
    );
  } catch {
    // A lease we cannot record is a missed collision warning, not a reason to
    // block the user's edit. Surface it and continue.
    process.stderr.write("file-lease: could not record lease\n");
  }
}

/** Drop leases nobody has touched for an hour so the directory stays small. */
function sweep() {
  try {
    for (const name of readdirSync(leaseDir)) {
      const full = path.join(leaseDir, name);
      if (now - statSync(full).mtimeMs > SWEEP_AFTER_MS) unlinkSync(full);
    }
  } catch {
    /* best effort */
  }
}

function show(target) {
  const rel = path.relative(root, target);
  return rel.startsWith("..") ? target : rel;
}

function readLease(target) {
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8"));
    return typeof parsed?.session === "string" && typeof parsed?.at === "number"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function mtimeOf(target) {
  try {
    return statSync(target).mtimeMs;
  } catch {
    return null;
  }
}

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.stderr.write("file-lease: unreadable hook input\n");
    process.exit(0);
  }
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function allow() {
  process.exit(0);
}

