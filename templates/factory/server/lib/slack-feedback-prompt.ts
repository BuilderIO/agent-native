export const SLACK_MENTION_GUARD =
  "Never post Slack messages, reactions, or plaintext @handles yourself. Call start-builder-for-item; that action pings Builder with a Slack user id. Plaintext @builder.io does not notify anyone.";

export const SLACK_HANDOFF_INSTRUCTION = `Do not post to Slack, add reactions, or type @handles yourself. Call
start-builder-for-item; that action adds 👀 and pings Builder with a Slack
user id so it runs /address-feedback. The posted reply points Builder at the
relevant repository skills, the representative source, every related source,
and the need to fix the underlying boundary across the whole cluster. Never
call that action for owner-managed Clips, Design, or Content work, or for a
non-bug report.`;

const OBSOLETE_SLACK_TAG_PARAGRAPH =
  /The Builder reply must tag @builder\.io[\s\S]*?non-bug\s+report\.\s*/;

export function repairSlackFeedbackPrompt(content: string): string {
  let next = content.replace(
    OBSOLETE_SLACK_TAG_PARAGRAPH,
    `${SLACK_HANDOFF_INSTRUCTION}\n\n`,
  );
  if (/tag @builder\.io/i.test(next)) {
    next = next
      .split("\n")
      .filter((line) => !/tag @builder\.io/i.test(line))
      .join("\n");
  }
  if (!next.includes(SLACK_MENTION_GUARD)) {
    next = `${next.trimEnd()}\n\n${SLACK_MENTION_GUARD}\n`;
  }
  return next;
}
