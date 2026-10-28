export const FACTORY_ALIGNMENT_REVISION = 4;

const ALIGNMENT_START = "<!-- factory-skill-alignment:start -->";
const ALIGNMENT_END = "<!-- factory-skill-alignment:end -->";

const PR_ALIGNMENT = `## Current review-prs contract

The repository's \`.agents/skills/review-prs/SKILL.md\` is authoritative.
Ignore drafts, bot-authored pull requests, and PRs authored by the exact login
\`steve8708\` completely. Verify the current BuilderIO organization membership
for every other author before applying the existing-approval filter. For a
confirmed nonmember's fork PR assigned to a
verified current BuilderIO member, stop completely under \`community-prs\`: do
not review, reply, call the governance action, merge, or recap it. For every
other confirmed external PR, call \`govern-factory-pull-request\` to record a
manual disposition even if it already has a current-head approval; never
approve it or use the manual external-scope or reply path. For verified
internal authors, only an eligible current-head approval with no newer event
can suppress duplicate code review; it does not remove the PR from the readiness
pass or recap. Eligible Liam PRs with only older-head approvals remain
candidates so the current head can be approved. For every remaining PR, read
the complete title,
body, links, changed-file diff (including generated and migration files), all
review summaries/comments/replies, actual check conclusions, and ownership
boundary. Verify current BuilderIO organization membership through GitHub's
organization API - never infer it from a name, association, branch, email, or
bot label.

Never approve external or unverified authors. The internal-author exception
allows ordinary failed, pending, skipped, or unknown checks and ordinary
unresolved feedback for a verified BuilderIO member; record those exact states
and never call them clean. Include the exact check and actionable-feedback
states in every approval recap, even when ordinary gates are overridden, and
distinguish approval from readiness. The ultra-scary gate always remains manual
for auth,
permissions, tenant isolation, secrets, destructive data loss or migrations,
remote code execution, MCP iframe sandboxing, CSP, HTML sanitization, SSRF,
payments, deployment, or unexplained dependency and infrastructure risk. Active
credible safety findings in fresh review evidence remain blocking for every
author, including Liam.

For the exact \`liamdebeasi\` login and immutable GitHub user ID \`2721089\`, a
current BuilderIO membership check is still required. When the current,
non-draft PR has no current-head, non-dismissed approval, the Liam exception
allows approval across ordinary check, review-feedback, scope, and UX-owner
gates without authorizing a merge. It does not apply to ultra-scary changes or
changes to review/approval policy, agent-safety instructions, membership
verification, or CI/deployment security controls; those require independent
human review.

The verified owner exceptions are current and must be applied only after
membership and the ultra-scary assessment: Alice (\`3mdistal\`) for Content,
Nick (\`NKoech123\`) for Slides, Enzo (\`enzoames\`) for Factory-specific PRs,
and Sid (\`sidmohanty11\`) for Design. Alice and Nick may include supporting
shared framework/Desktop plumbing required by their app feature. For
BuilderIO/agent-native PRs, Shomix (shomix, GitHub user ID 100691266) may be
auto-approved across app and framework areas, including UX changes, refactors,
ordinary unresolved feedback, and failed or pending checks. Match both the login
and immutable GitHub author ID; do not rely on login alone. This exception never
applies to review/approval policy, agent-safety instructions, membership
verification, or CI/deployment security changes;
those require independent human review. The docs-only
exception applies to \`kapunahelewong\` and Wes (\`bwreid\`) only when every
changed file is documentation, localization, docs navigation/redirect, or a
docs-specific test. These exceptions cover ordinary UX/refactor/check/review
gates but never membership, external-author, or ultra-scary gates.

Approve only when the remaining standard evidence supports a clear,
repo-owned, narrow root-cause change with unambiguous scope. Approval is a
trust decision only - never auto-merge. Never claim ignored checks or feedback
are resolved, and record one concise disposition for every PR that entered the
evidence sweep.`;

export type FactoryAutomationName = "factory-pr-governance";

export function managedReviewSkillAlignment(
  name: FactoryAutomationName,
): string | undefined {
  return name === "factory-pr-governance" ? PR_ALIGNMENT : undefined;
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
