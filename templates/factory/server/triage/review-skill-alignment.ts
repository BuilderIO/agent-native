const ALIGNMENT_START = "<!-- factory-skill-alignment:start -->";
const ALIGNMENT_END = "<!-- factory-skill-alignment:end -->";

const FEEDBACK_ALIGNMENT = `## Current review-latest-feedback contract

The repository's \`.agents/skills/review-latest-feedback/SKILL.md\` is
authoritative. Re-read it in the Builder worktree before acting. Its current
contract is evidence-first and reply-producing:

- Recheck answered clarifications and open In progress ownership before newer
  work. Keep the newest unhandled item as the cursor, read older duplicates
  into one verified cluster, and leave an auditable disposition for every
  inspected Slack, GitHub issue, and Sentry item.
- Read the complete parent/thread, reactions, attachments, linked artifacts,
  and newer follow-ups before asking anything or dispatching. An unavailable
  source is unavailable evidence, never a no-results result.
- Keep one specific unanswered clarification per thread. Re-read the whole
  thread when the requested detail is answered, try the fix first, and use the
  task-scoped clarification ledger with a stable scheduler identity for
  recurring rechecks. Do not claim scheduled coverage without stable durable
  state.
- Check the existing Slack 👀 marker and owner before any write. Preserve an
  existing marker; if reactions cannot be read, do not guess or add one. Do
  not react to or dispatch Design UX/interaction work (Sid) or any Content
  work (Alice); record the owner instead.
- For an actionable repo-owned Slack item with no existing marker, 👀 is the
  first external write. Every parent this run marks must later receive a
  verified @agent-native Fixed, In progress, or Clarification needed reply;
  an eye, forward, generic acknowledgement, or another person's reply is not
  a disposition. Group only genuinely repeated symptoms and dispatch one
  Builder thread for the cluster.
- Choose the smallest owning seam: local regression for one symptom, shared
  contract for repeated cross-surface evidence, discovery/action wiring for a
  missing capability, and release/deployment diagnosis for source-versus-live
  mismatches. Do not turn one report into a global prompt rule.
- Keep source-tested, built, published/deployed, and observed-live evidence
  separate. Do not claim a fix, PR, reply, or deployment without confirmation
  from the relevant action or runtime evidence.

After classifying every processed item, call \`start-builder-for-item\` with
\`clearBug: true\` or \`false\` and a concise evidence-grounded reason so every
skip or dispatch is recorded.`;

const PR_ALIGNMENT = `## Current review-prs contract

The repository's \`.agents/skills/review-prs/SKILL.md\` is authoritative.
Before selecting work, ignore drafts and pull requests with a current,
non-dismissed APPROVED review, including bot approvals; do not inspect or
recap those excluded items. For every remaining PR, read the complete title,
body, links, changed-file diff (including generated and migration files), all
review summaries/comments/replies, actual check conclusions, and ownership
boundary. Verify current BuilderIO organization membership through GitHub's
organization API - never infer it from a name, association, branch, email, or
bot label.

Never approve external or unverified authors. The internal-author exception
allows ordinary failed, pending, skipped, or unknown checks and ordinary
unresolved feedback for a verified BuilderIO member; record those exact states
and never call them clean. The ultra-scary gate always remains manual for auth,
permissions, tenant isolation, secrets, destructive data loss or migrations,
remote code execution, SSRF, payments, deployment, or unexplained dependency
and infrastructure risk.

The verified owner exceptions are current and must be applied only after
membership and the ultra-scary assessment: Alice (\`3mdistal\`) for Content,
Nick (\`NKoech123\`) for Slides, Enzo (\`enzoames\`) for Factory-specific PRs,
and Sid (\`sidmohanty11\`) for Design. Alice and Nick may include supporting
shared framework/Desktop plumbing required by their app feature. The docs-only
exception applies to \`kapunahelewong\` and Wes (\`bwreid\`) only when every
changed file is documentation, localization, docs navigation/redirect, or a
docs-specific test. These exceptions cover ordinary UX/refactor/check/review
gates but never membership, external-author, or ultra-scary gates.

Approve only when the remaining standard evidence supports a clear,
repo-owned, narrow root-cause change with unambiguous scope. Approval is a
trust decision only - never auto-merge. Never claim ignored checks or feedback
are resolved, and record one concise disposition for every PR that entered the
evidence sweep.`;

export type FactoryAutomationName =
  | "factory-slack-feedback"
  | "factory-sentry-errors"
  | "factory-github-issues"
  | "factory-pr-governance"
  | "factory-pr-babysit";

export function managedReviewSkillAlignment(
  name: FactoryAutomationName,
): string | undefined {
  if (
    name === "factory-slack-feedback" ||
    name === "factory-sentry-errors" ||
    name === "factory-github-issues"
  ) {
    return FEEDBACK_ALIGNMENT;
  }
  if (name === "factory-pr-governance") return PR_ALIGNMENT;
  return undefined;
}

export function syncManagedReviewSkillAlignment(
  content: string,
  name: FactoryAutomationName,
): string {
  const alignment = managedReviewSkillAlignment(name);
  if (!alignment) return content;

  const block = `${ALIGNMENT_START}\n${alignment.trim()}\n${ALIGNMENT_END}`;
  const existingBlock = new RegExp(
    `${escapeRegExp(ALIGNMENT_START)}[\\s\\S]*?${escapeRegExp(ALIGNMENT_END)}`,
  );
  if (existingBlock.test(content)) {
    return content.replace(existingBlock, block);
  }
  return `${content.trimEnd()}\n\n${block}\n`;
}

export function managedReviewSkillAlignmentMarkers(): {
  start: string;
  end: string;
} {
  return { start: ALIGNMENT_START, end: ALIGNMENT_END };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
