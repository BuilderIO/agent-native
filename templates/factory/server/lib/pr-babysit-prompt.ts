import { renameFactoryActionMentions } from "./factory-action-names.js";

export const BABYSIT_LIST_BOUND =
  "Runtime safety bound: call list-triage-items with needsReview true, source github, and limit 3; process at most three pull-request items.";

export const BABYSIT_SCOPE_INSTRUCTION =
  "Each listed item includes author. Call babysit-factory-pull-request for every item. Pass inScope true only for PRs authored by builder-io-bot or builder-io-integration[bot], including GitHub bot login variants. Pass inScope false for every other author so the item leaves the review window.";

const OBSOLETE_BUILDER_BOT_ONLY_BOUND =
  "Runtime safety bound: call list-triage-items with needsReview true, source github, builderBotOnly true, and limit 3; process at most three builder-bot pull-request items.";

const OBSOLETE_COMMIT_RETRIGGER =
  /A changed commit,\s*new unresolved\s*feedback, failing or pending CI, or merge conflict starts a new bounded\s*request; twenty minutes without new work to address ends that babysitting\s*window\./g;

const OBSOLETE_BABYSIT_OWNS_EVIDENCE =
  /When inScope is true, call babysit-factory-pull-request\. It owns GitHub\s*evidence, the hardcoded comment, and the quiet window\./g;

export const BABYSIT_WORK_RETRIGGER =
  "A new commit, pending CI, or GitHub finishing mergeability does not start another comment. New unanswered human review feedback, or a merge conflict that appeared after the branch was known to be conflict-free, can. Do not ask the bot to poll or loop; Factory re-checks on its schedule.";

export const BABYSIT_DECISION_INSTRUCTION =
  "For every in-scope item call propose-pr-babysit-status, then call babysit-factory-pull-request with decision. Use ping only for new human review feedback, or for a merge conflict that appeared after the branch was known to be conflict-free; GitHub finishing its merge calculation is not new work. Use already_asked when Factory already asked during this round of work. Use stuck when another request cannot unblock the pull request, so a human has to look.";

export function repairPrBabysitPrompt(content: string): string {
  let next = renameFactoryActionMentions(content)
    .split(OBSOLETE_BUILDER_BOT_ONLY_BOUND)
    .join(BABYSIT_LIST_BOUND);
  next = next.replace(OBSOLETE_COMMIT_RETRIGGER, BABYSIT_WORK_RETRIGGER);
  next = next.replace(
    OBSOLETE_BABYSIT_OWNS_EVIDENCE,
    BABYSIT_DECISION_INSTRUCTION,
  );
  next = next.split("builderBotOnly true, ").join("");
  next = next.split("builderBotOnly true").join("");
  next = next.replace(/\s+,/g, ",");
  if (!next.includes(BABYSIT_LIST_BOUND)) {
    next = `${next.trimEnd()}\n\n${BABYSIT_LIST_BOUND}\n`;
  }
  if (!next.includes("inScope true")) {
    next = `${next.trimEnd()}\n\n${BABYSIT_SCOPE_INSTRUCTION}\n`;
  }
  // A prompt that never learns `decision` makes the agent call the action
  // without one, and the action throws rather than guessing a ping.
  if (!next.includes("propose-pr-babysit-status")) {
    next = `${next.trimEnd()}\n\n${BABYSIT_DECISION_INSTRUCTION}\n`;
  }
  const first = next.indexOf(BABYSIT_LIST_BOUND);
  const second = next.indexOf(BABYSIT_LIST_BOUND, first + 1);
  if (first !== -1 && second !== -1) {
    next =
      next.slice(0, second) + next.slice(second + BABYSIT_LIST_BOUND.length);
    next = next.replace(/\n{3,}/g, "\n\n");
  }
  return next;
}
