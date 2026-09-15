import { renameFactoryActionMentions } from "./factory-action-names.js";

export const BABYSIT_LIST_BOUND =
  "Runtime safety bound: call poll-github-sources with includeIssues false and includePullRequests true, then list-triage-items with needsReview true, source github, and limit 3; process at most three pull-request items. If the list is empty, stop.";

export const BABYSIT_SCOPE_INSTRUCTION =
  "Each listed item includes author. Call babysit-factory-pull-request for every item. Pass inScope true only for PRs authored by builder-io-bot or builder-io-integration[bot], including GitHub bot login variants. Pass inScope false for every other author so the item leaves the review window.";

export const BABYSIT_FIXED_PATH =
  "Follow this fixed path only: poll-github-sources, list-triage-items (stop if empty), then for each listed item call propose-pr-babysit-status and babysit-factory-pull-request, then stop. Do not review diffs, call governance actions, or use ad-hoc GitHub tools.";

export const BABYSIT_WORK_RETRIGGER =
  "Unresolved human or bot review feedback, failing blocking CI, or a merge conflict that appeared after the branch was known conflict-free can authorize another ping. Builder activity, running CI, new commits, or GitHub finishing mergeability alone do not.";

export const BABYSIT_DECISION_INSTRUCTION =
  "For every in-scope item call propose-pr-babysit-status first, read recommendation and because, then call babysit-factory-pull-request with decision. Follow recommendation unless the briefing clearly contradicts it. Use ping when recommendation is ping. Use defer when recommendation is defer (Builder active within the quiet window). Use already_asked when recommendation is already_asked or clean. Use stuck when recommendation is stuck or bot errors after a ping make another ask useless. Never approve or merge.";

const OBSOLETE_BUILDER_BOT_ONLY_BOUND =
  "Runtime safety bound: call list-triage-items with needsReview true, source github, builderBotOnly true, and limit 3; process at most three builder-bot pull-request items.";

const OBSOLETE_COMMIT_RETRIGGER =
  /A changed commit,\s*new unresolved\s*feedback, failing or pending CI, or merge conflict starts a new bounded\s*request; twenty minutes without new work to address ends that babysitting\s*window\./g;

const OBSOLETE_BABYSIT_OWNS_EVIDENCE =
  /When inScope is true, call babysit-factory-pull-request\. It owns GitHub\s*evidence, the hardcoded comment, and the quiet window\./g;

const OBSOLETE_BABYSIT_DECISION_NO_FIRST_ASK =
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
  if (!next.includes(BABYSIT_FIXED_PATH)) {
    next = `${next.trimEnd()}\n\n${BABYSIT_FIXED_PATH}\n`;
  }
  if (!next.includes("read recommendation and because")) {
    if (next.includes(OBSOLETE_BABYSIT_DECISION_NO_FIRST_ASK)) {
      next = next
        .split(OBSOLETE_BABYSIT_DECISION_NO_FIRST_ASK)
        .join(BABYSIT_DECISION_INSTRUCTION);
    } else {
      next = `${next.trimEnd()}\n\n${BABYSIT_DECISION_INSTRUCTION}\n`;
    }
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
