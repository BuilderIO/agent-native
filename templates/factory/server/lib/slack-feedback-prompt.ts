import { renameFactoryActionMentions } from "./factory-action-names.js";

const PASTED_SKIP_GUARD =
  "After classifying each processed item, call dispatch-factory-item with clearBug true or false and a short evidence-grounded reason so the skip or dispatch is recorded.";

const PASTED_MENTION_GUARD =
  "Never post Slack messages, reactions, or plaintext @handles yourself. Call dispatch-factory-item; that action pings Builder with a Slack user id. Plaintext @builder.io does not notify anyone.";

const PASTED_HANDOFF_INSTRUCTION = `Do not post to Slack, add reactions, or type @handles yourself. Call
dispatch-factory-item; that action adds 👀 and pings Builder with a Slack
user id so it runs /address-feedback. The posted reply points Builder at the
relevant repository skills, the representative source, every related source,
and the need to fix the underlying boundary across the whole cluster. Never
call that action for owner-managed Clips, Design, or Content work, or for a
non-bug report.`;

const OBSOLETE_SLACK_TAG_PARAGRAPH =
  /The Builder reply must tag @builder\.io[\s\S]*?non-bug\s+report\.\s*/;

function stripPastedGuard(content: string, pasted: string): string {
  return content.split(pasted).join("");
}

export function repairSlackFeedbackPrompt(content: string): string {
  let next = renameFactoryActionMentions(content).replace(
    OBSOLETE_SLACK_TAG_PARAGRAPH,
    "",
  );
  if (/tag @builder\.io/i.test(next)) {
    next = next
      .split("\n")
      .filter((line) => !/tag @builder\.io/i.test(line))
      .join("\n");
  }
  next = stripPastedGuard(next, PASTED_HANDOFF_INSTRUCTION);
  next = stripPastedGuard(next, PASTED_MENTION_GUARD);
  next = stripPastedGuard(next, PASTED_SKIP_GUARD);
  return `${next.replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
