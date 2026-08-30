import { renameFactoryActionMentions } from "./factory-action-names.js";

export const BABYSIT_LIST_BOUND =
  "Runtime safety bound: call list-triage-items with needsReview true, source github, and limit 3; process at most three pull-request items.";

export const BABYSIT_SCOPE_INSTRUCTION =
  "Each listed item includes author. Call babysit-factory-pull-request for every item. Pass inScope true only for PRs authored by builder-io-bot or builder-io-integration[bot], including GitHub bot login variants. Pass inScope false for every other author so the item leaves the review window.";

const OBSOLETE_BUILDER_BOT_ONLY_BOUND =
  "Runtime safety bound: call list-triage-items with needsReview true, source github, builderBotOnly true, and limit 3; process at most three builder-bot pull-request items.";

export function repairPrBabysitPrompt(content: string): string {
  let next = renameFactoryActionMentions(content).replaceAll(
    OBSOLETE_BUILDER_BOT_ONLY_BOUND,
    BABYSIT_LIST_BOUND,
  );
  next = next.replaceAll("builderBotOnly true, ", "");
  next = next.replaceAll("builderBotOnly true", "");
  next = next.replace(/\s+,/g, ",");
  if (!next.includes(BABYSIT_LIST_BOUND)) {
    next = `${next.trimEnd()}\n\n${BABYSIT_LIST_BOUND}\n`;
  }
  if (!next.includes("inScope true")) {
    next = `${next.trimEnd()}\n\n${BABYSIT_SCOPE_INSTRUCTION}\n`;
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
