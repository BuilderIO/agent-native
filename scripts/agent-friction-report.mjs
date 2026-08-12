#!/usr/bin/env node
/**
 * agent-friction-report.mjs
 *
 * Measures how often the user has to correct an agent about the same thing,
 * by reading local Claude Code and Codex transcripts and counting matches for
 * a table of known friction patterns, bucketed by week.
 *
 * Why this exists: on 2026-07-31 an audit claimed unrequested branch creation
 * was a live problem needing a tool-level block. Measuring it showed the
 * opposite — 10 occurrences in early July, then zero in the twelve days after
 * `.agents/skills/new-branch/SKILL.md` gained its activation guard. Guidance
 * had already closed it, and a block would only have fired on the correct
 * post-merge workflow.
 *
 * That is the whole point: a claim about agent behaviour is checkable, and the
 * check is cheap. Before adding any mechanism that constrains agents, run this
 * and confirm the pattern is still live. After changing a skill, run it again
 * a couple of weeks later and confirm the pattern actually declined. A rule
 * nobody measures is a rule nobody can tell is working.
 *
 * Usage:
 *   node scripts/agent-friction-report.mjs                # last 8 weeks
 *   node scripts/agent-friction-report.mjs --weeks 4
 *   node scripts/agent-friction-report.mjs --pattern cheap-model
 *
 * Reads only local transcript files; makes no network calls and writes nothing.
 */

import { readdirSync, statSync, createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

/**
 * Each entry is a correction the user should not have to repeat. `fixedBy`
 * records the guidance that was supposed to close it, so a pattern that keeps
 * climbing after its skill landed is a visible failure of that skill — not a
 * reason to reach for a tool-level block first.
 */
const PATTERNS = [
  {
    key: "branch-moves",
    label: "Unrequested branch creation / movement",
    fixedBy: ".agents/skills/new-branch (activation guard, 2026-07-28)",
    re: /\b(did you (make|create).*(new )?branch|don'?t (make|create).*branch|never.*(make|create).*branch|why.*new branch)\b/i,
  },
  {
    key: "false-done",
    label: "Reported done while still broken",
    fixedBy: ".agents/skills/verifying-changes (2026-07-31)",
    re: /\b(you (said|claimed) (you )?fixed|third time|still (broken|not working|happening)|didn'?t (actually )?(work|fix)|not (actually )?fixed)\b/i,
  },
  {
    key: "stopped-early",
    label: "Stopped mid-task / queued instead of doing",
    fixedBy: ".agents/skills/verifying-changes (2026-07-31)",
    re: /\b(stop stopping|keep stopping|why (did|do) you stop|don'?t stop|still queued|should be doing everything now)\b/i,
  },
  {
    key: "cheap-model",
    label: "Told to delegate to a cheaper model",
    fixedBy: ".agents/skills/delegating-work (2026-07-31)",
    re: /\b(coding on the main thread|cheaper (sub ?agents?|models?)|use (sonnet|terra|luna|haiku)|not you,? the main thread|don'?t use (you|fable|opus))\b/i,
  },
  {
    key: "missed-siblings",
    label: "Had to ask whether sibling call sites were swept",
    fixedBy: ".agents/skills/fix-at-the-boundary (2026-07-31)",
    re: /\b(any other (apps?|providers?|templates?|places?)|other (apps?|templates?) (that )?do(es)? this|same (bug|issue|thing) (in|across)|sweep of other|fix that too)\b/i,
  },
  {
    key: "collision",
    label: "Agents clobbering each other in the shared checkout",
    fixedBy: ".agents/skills/concurrent-agents + scripts/hooks/file-lease.mjs",
    re: /\b(collision|overwrit\w+|clobber\w*|reverted (my|our|their) work|lost (my|our) (work|edits)|another agent (is|was) (shipping|editing))\b/i,
  },
  {
    key: "unpushed-work",
    label: "Had to demand local work be pushed",
    fixedBy: "pnpm ship:push (scripts/ship-push.mjs, 2026-08-12)",
    re: /\b(push (up|it up|them up|all|everything|shit up)|not pushed|never pushed|unpushed|files to push|tons of (local|files)|push the local)\b/i,
  },
  {
    key: "no-progress",
    label: "Had to chase status on a long-running run",
    fixedBy: "unstated — no owning skill yet",
    re: /\b(hows? (it going|we looking)|what'?s the status|are we done|you done|did you finish|how close|still (going|running|working)|progress check|any update)\b/i,
  },
  {
    key: "cross-thread-interference",
    label: "Agent acted on other agents' threads or work uninvited",
    fixedBy: "unstated — no owning skill yet",
    re: /\b(other (chats?|threads?|agents?)|pause (their|other)|don'?t (tell|message) (other|the other)|didn'?t ask you to (touch|message))\b/i,
  },
];

const args = process.argv.slice(2);
const weeks = Number(valueOf("--weeks") ?? 8);
const only = valueOf("--pattern");
if (!Number.isInteger(weeks) || weeks < 1)
  fail(`--weeks must be a positive integer`);

const cutoff = Date.now() - weeks * 7 * 24 * 60 * 60 * 1000;
const selected = only ? PATTERNS.filter((p) => p.key === only) : PATTERNS;
if (selected.length === 0)
  fail(
    `unknown --pattern ${only}. Known: ${PATTERNS.map((p) => p.key).join(", ")}`,
  );

const sources = [
  {
    name: "Claude Code",
    root: path.join(os.homedir(), ".claude", "projects"),
    read: claudeMessage,
  },
  {
    name: "Codex",
    root: path.join(os.homedir(), ".codex", "sessions"),
    read: codexMessage,
  },
];

const counts = new Map(selected.map((p) => [p.key, new Map()]));
const lastSeen = new Map();
let scanned = 0;
let messages = 0;

for (const source of sources) {
  const files = walk(source.root).filter(
    (f) => f.endsWith(".jsonl") && mtime(f) >= cutoff,
  );
  // A source with no readable transcripts is not "no friction" — say so, or a
  // missing history directory reads as a clean report.
  if (files.length === 0) {
    process.stderr.write(
      `[friction] no ${source.name} transcripts newer than ${weeks}w under ${source.root}\n`,
    );
    continue;
  }
  scanned += files.length;
  for (const file of files) await scan(file, source.read);
}

if (scanned === 0)
  fail("no transcripts found for either harness — cannot report");

report();

async function scan(file, read) {
  let stream;
  try {
    stream = createReadStream(file, { encoding: "utf8" });
  } catch {
    process.stderr.write(`[friction] unreadable: ${file}\n`);
    return;
  }
  for await (const line of createInterface({
    input: stream,
    crlfDelay: Infinity,
  })) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const found = read(entry);
    if (!found) continue;
    const { text, at } = found;
    if (!at || at < cutoff) continue;
    messages += 1;
    for (const pattern of selected) {
      if (!pattern.re.test(text)) continue;
      const week = weekOf(at);
      const bucket = counts.get(pattern.key);
      bucket.set(week, (bucket.get(week) ?? 0) + 1);
      const previous = lastSeen.get(pattern.key) ?? 0;
      if (at > previous) lastSeen.set(pattern.key, at);
    }
  }
}

function claudeMessage(entry) {
  const at = Date.parse(entry?.timestamp ?? "");
  if (entry?.type === "queue-operation" && entry.operation === "enqueue") {
    return { text: String(entry.content ?? ""), at };
  }
  if (entry?.type !== "user" || entry.isSidechain) return null;
  const content = entry?.message?.content;
  if (typeof content === "string") return { text: content, at };
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((part) => part?.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  return text ? { text, at } : null;
}

function codexMessage(entry) {
  if (entry?.type !== "event_msg" || entry?.payload?.type !== "user_message")
    return null;
  const text = String(entry.payload.message ?? "");
  // Codex replays tool and automation traffic through the same event type.
  if (!text || text.startsWith("<")) return null;
  return { text, at: Date.parse(entry?.timestamp ?? "") };
}

function report() {
  const buckets = [];
  for (let index = weeks - 1; index >= 0; index -= 1) {
    buckets.push(weekOf(Date.now() - index * 7 * 24 * 60 * 60 * 1000));
  }
  const unique = [...new Set(buckets)];

  console.log(`\nAgent friction over the last ${weeks} weeks`);
  console.log(`${scanned} transcripts, ${messages} user messages\n`);
  const width = Math.max(...selected.map((p) => p.label.length));

  for (const pattern of selected) {
    const bucket = counts.get(pattern.key);
    const series = unique.map((week) => bucket.get(week) ?? 0);
    const total = series.reduce((sum, n) => sum + n, 0);
    const seen = lastSeen.get(pattern.key);
    console.log(
      `${pattern.label.padEnd(width)}  ${series.map((n) => String(n).padStart(3)).join("")}   total ${String(total).padStart(3)}   last ${seen ? new Date(seen).toISOString().slice(0, 10) : "never"}`,
    );
    console.log(`${" ".repeat(width)}  carried by ${pattern.fixedBy}\n`);
  }

  console.log(`weeks, oldest to newest: ${unique.join("  ")}`);
  console.log(
    `\nA pattern that keeps climbing after its guidance landed means the guidance is\n` +
      `not working — rewrite it to name the situation the agent is actually tempted\n` +
      `in. Reach for a mechanism only once guidance has measurably failed.\n`,
  );
}

function weekOf(ms) {
  const date = new Date(ms);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(5, 10);
}

function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

function mtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function fail(message) {
  process.stderr.write(`[friction] ${message}\n`);
  process.exit(1);
}
