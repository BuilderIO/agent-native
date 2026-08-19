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
 *   node scripts/agent-friction-report.mjs --self-test
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
const FOLLOWUP_ACTION = String.raw`(?:check(?:ed)?(?:\s+(?:back|whether|if))?|re-?check(?:ed)?|follow(?:ed)?[ -]+up(?:\s+(?:on|with))?|re-?read|revisit|re-?triage|disposition)`;
const FOLLOWUP_TARGET = String.raw`(?:clarification|unanswered\s+feedback|follow[ -]?up|reporter|repl(?:y|ies|ied)|response|thread)`;
const MISSED_FOLLOWUP_CONTEXT = String.raw`(?:miss(?:ed|ing)|prior|previous(?:ly)?|unanswered|pending|no\s+(?:reply|response)|still\s+(?:waiting|unanswered|no\s+(?:reply|response))|waiting\s+for|asked\s+for|requested\s+(?:a\s+)?clarification|reporter\s+(?:hasn['’]t|didn['’]t|never)\s+(?:repl(?:y|ied|ies)|respond))`;
const FEEDBACK_CORRECTION_GUARDS = String.raw`(?=[^.!?]{0,140}\b${FOLLOWUP_ACTION}\b)(?=[^.!?]{0,140}\b${FOLLOWUP_TARGET}\b)(?=[^.!?]{0,140}\b${MISSED_FOLLOWUP_CONTEXT}\b)[^.!?]{0,180}`;

const UNANSWERED_FEEDBACK_FOLLOWUP_RE = new RegExp(
  [
    String.raw`\b(?:did|have)\s+(?:you|we)\s+check\s+(?:whether|if)\s+the\s+reporter\s+(?:repl(?:y|ies|ied)|respond(?:ed|s)?)\s+to\s+the\s+clarification\b`,
    String.raw`\b(?:did|have)\s+(?:you|we)\b${FEEDBACK_CORRECTION_GUARDS}`,
    String.raw`\b(?:you|we)\s+(?:still\s+)?(?:haven['’]t|didn['’]t|never)\b${FEEDBACK_CORRECTION_GUARDS}`,
    String.raw`\b(?:why|how\s+come)\b[^.!?]{0,80}\b(?:didn['’]t|haven['’]t|never|still|not)\b${FEEDBACK_CORRECTION_GUARDS}`,
    String.raw`\b(?:please|can you|make sure|be sure)\b${FEEDBACK_CORRECTION_GUARDS}`,
  ].join("|"),
  "i",
);

const FEEDBACK_REGEX_CASES = [
  [true, "Did you recheck the unanswered feedback?"],
  [true, "Did you check whether the reporter replied to the clarification?"],
  [true, "Have you followed up on the clarification after the prior request?"],
  [true, "Why haven't you re-read the thread after the missed reporter reply?"],
  [true, "Please re-triage the pending clarification; no response arrived."],
  [false, "Have you checked back with the reporter about the thread?"],
  [false, "Please re-triage this clarification."],
  [false, "Nobody has responded."],
  [false, "Can you re-read the thread after the deploy?"],
  [false, "Did you re-triage this clarification again?"],
  [false, "Answered clarification from yesterday."],
  [false, "Follow-up pass complete."],
  [false, "eyes-only thread"],
];

if (process.argv.includes("--self-test")) {
  const failures = FEEDBACK_REGEX_CASES.filter(
    ([expected, message]) =>
      UNANSWERED_FEEDBACK_FOLLOWUP_RE.test(message) !== expected,
  );
  if (failures.length > 0) {
    console.error("Feedback regex self-test failed:", failures);
    process.exitCode = 1;
  } else {
    console.log(
      `Feedback regex self-test passed (${FEEDBACK_REGEX_CASES.length} cases).`,
    );
  }
  process.exit(0);
}

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
    key: "unanswered-feedback-followup",
    label: "Had to ask whether unanswered feedback was rechecked",
    fixedBy: ".agents/skills/review-latest-feedback (2026-08-19)",
    // Keep this correction-specific: routine re-triage, answered-clarification,
    // eyes-only, and reporter-status text are not friction by themselves.
    re: UNANSWERED_FEEDBACK_FOLLOWUP_RE,
  },
  {
    key: "collision",
    label: "Agents clobbering each other in the shared checkout",
    fixedBy: ".agents/skills/concurrent-agents",
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
    fixedBy: ".agents/skills/reporting-progress (2026-08-12)",
    re: /\b(hows? (it going|we looking)|what'?s the status|are we done|you done|did you finish|how close|still (going|running|working)|progress check|any update)\b/i,
  },
  {
    key: "cross-thread-interference",
    label: "Agent acted on other agents' threads or work uninvited",
    fixedBy: ".agents/skills/reporting-progress (2026-08-12)",
    re: /\b(other (chats?|threads?|agents?)|pause (their|other)|don'?t (tell|message) (other|the other)|didn'?t ask you to (touch|message))\b/i,
  },
  // Measured for the first time on 2026-08-12, after three prose rewrites of the
  // same rule (c497c859fa, 061896a301, 44ac2c4acf) shipped with no key at all.
  // That is why the 2026-08-09 attempt could delete its own concrete rules nine
  // minutes after writing them and no number moved. Baseline the day the key
  // landed: 51 · 28 over the two weeks to 2026-08-12, total 79 — the largest row
  // in this table, and the only correction in it never previously counted.
  // Windowing is by file mtime, so read a sample of matches, not just the count:
  // a resumed session re-enters the window, a quiet fortnight cannot be told
  // apart from a vocabulary change, and roughly one match in ten is an untagged
  // subagent brief that `humanText` below does not recognize yet.
  {
    key: "text-heavy-ui",
    label: "Told the UI has too much text / chrome upfront",
    fixedBy:
      "guard:no-default-chrome + .agents/skills/frontend-design (2026-08-12)",
    re: /\b(too much (text|copy|chrome)|too many (words|titles|headers|labels|sections)|so much text|text[ -]?heavy|text overload|(less|fewer|way less|trim the|bloated with|unnecessary) (text|copy)|too (wordy|verbose)|too keen to add|descriptions? everywhere|remove (the|that) (descriptions?|titles?|headers?|breadcrumbs?|eyebrows?|subtitles?|blurb|subtext|copy|top bar|bottom row)|(we|i) don'?t need (the|these|those|that|all|an?)[^.!?]{0,50}\b(text|titles?|headers?|sections?|descriptions?|eyebrows?|labels?|rows?|blocks?|copy|line|about)|don'?t show the (sub ?text|description|title)|eyebrows?\b|overwhelming|clutter(ed)?\b|too busy|in your face|minimal u[ix]|less info upfront|progressive disclosure)/i,
  },
  // Measured for the first time on 2026-08-13, alongside the app-config schema
  // and the `configuration` skill. There was no key while core grew to 301
  // distinct environment variables, 253 of which are product behavior rather
  // than secrets — so the habit was never counted, only noticed once the total
  // was large enough to argue about. Baseline over the two weeks to 2026-08-13
  // is recorded in plans/core-configuration-attack-plan.md; the number to watch
  // is whether it stays flat while the schema absorbs domains, because a rising
  // count means declaring a field is still more expensive than reaching for
  // `process.env` and step 9 (generated docs and key sets) is the missing half.
  {
    key: "config-sprawl",
    label: "Told to stop adding environment variables / bespoke config",
    fixedBy:
      ".agents/skills/configuration + packages/core/src/app-config (2026-08-13)",
    re: /\b((another|a new|more|adding|stop adding|why (another|a new|an?))[^.!?]{0,40}\benv(ironment)? ?(vars?|variables?|keys?)|env(ironment)? ?(vars?|variables?) (should (only|just|not)|are (only|just)|only for)|shouldn'?t need (an? )?env|without (needing |requiring )?(an? )?env(ironment)? ?(var|variable|key)|no more env|too many env|why (is|does) this (an? )?env|hardcod\w+ (the )?(env|config)|second (way|namespace) to (set|configure))/i,
  },
];

/**
 * Both harnesses replay machine-authored text through the user role. Two kinds
 * arrive, and conflating them is how a pattern count lies in both directions.
 *
 * AUTHORED — a subagent brief, delegation envelope, or watchdog transcript. No
 * human typed it. A brief that says "reduces text overload" is not the user
 * asking for anything, and counting it inflated this table by roughly a third
 * before these filters existed. Drop the whole message.
 *
 * ATTACHED — ambient UI state, a pasted screenshot, injected skill bodies:
 * wrappers around text the user really did type. The user's sharpest UI
 * corrections arrive with an `<image>` attached, so dropping these loses the
 * signal being measured. Strip the wrapper and keep the remainder.
 *
 * Never returns text a human did not type, and never returns "" — "machine
 * only" and "user said nothing" must stay the same answer, so a message that
 * strips to empty is not counted as friction.
 */
const AUTHORED_BY_AGENT =
  /<(subagent_notification|codex_delegation)\b|^\s*(The following is the Codex agent history|Claude here\s*[—-]\s*watchdog)/i;
const ATTACHED_BLOCK =
  /<(in-app-browser-context|user_message_metadata|environment_context|user_instructions|turn_aborted|task-notification|system-reminder|skill|image)\b[\s\S]*?(<\/\1>|\/>|$)/g;

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

function humanText(raw) {
  const raw_ = String(raw ?? "");
  if (AUTHORED_BY_AGENT.test(raw_)) return null;
  const text = raw_.replace(ATTACHED_BLOCK, " ").replace(/\s+/g, " ").trim();
  // A message that is still nothing but markup after stripping is machinery
  // whose wrapper this script does not know yet — not a quiet user.
  if (!text || text.startsWith("<")) return null;
  return text.length > 2 ? text : null;
}

function claudeMessage(entry) {
  const at = Date.parse(entry?.timestamp ?? "");
  if (entry?.type === "queue-operation" && entry.operation === "enqueue") {
    const text = humanText(entry.content);
    return text ? { text, at } : null;
  }
  if (entry?.type !== "user" || entry.isSidechain) return null;
  const content = entry?.message?.content;
  if (typeof content === "string") {
    const text = humanText(content);
    return text ? { text, at } : null;
  }
  if (!Array.isArray(content)) return null;
  const text = humanText(
    content
      .filter((part) => part?.type === "text")
      .map((part) => part.text ?? "")
      .join("\n"),
  );
  return text ? { text, at } : null;
}

function codexMessage(entry) {
  if (entry?.type !== "event_msg" || entry?.payload?.type !== "user_message")
    return null;
  const text = humanText(entry.payload.message);
  return text ? { text, at: Date.parse(entry?.timestamp ?? "") } : null;
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
