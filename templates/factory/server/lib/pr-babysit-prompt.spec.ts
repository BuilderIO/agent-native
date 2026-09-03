import { describe, expect, it } from "vitest";

import {
  BABYSIT_LIST_BOUND,
  BABYSIT_SCOPE_INSTRUCTION,
  BABYSIT_WORK_RETRIGGER,
  repairPrBabysitPrompt,
} from "./pr-babysit-prompt.js";

const obsoleteBound =
  "Runtime safety bound: call list-triage-items with needsReview true, source github, builderBotOnly true, and limit 3; process at most three builder-bot pull-request items.";

describe("repairPrBabysitPrompt", () => {
  it("removes builderBotOnly and adds the inScope instruction", () => {
    const existing = `# Factory builder-io-bot PR babysitting

List at most 3 new or changed pull requests by
passing needsReview true, source github, builderBotOnly true, and limit 3.

${obsoleteBound}
`;

    const repaired = repairPrBabysitPrompt(existing);

    expect(repaired).not.toContain("builderBotOnly");
    expect(repaired).toContain(BABYSIT_LIST_BOUND);
    expect(repaired).toContain(BABYSIT_SCOPE_INSTRUCTION);
    expect(repaired.match(new RegExp(BABYSIT_LIST_BOUND, "g"))).toHaveLength(1);
  });

  it("appends the list bound and scope instruction when missing", () => {
    const repaired = repairPrBabysitPrompt("# Factory PR babysitting\n");

    expect(repaired).toContain(BABYSIT_LIST_BOUND);
    expect(repaired).toContain(BABYSIT_SCOPE_INSTRUCTION);
  });

  it("replaces the old commit-retriggers-a-poke sentence", () => {
    const repaired = repairPrBabysitPrompt(`
A changed commit, new unresolved
feedback, failing or pending CI, or merge conflict starts a new bounded
request; twenty minutes without new work to address ends that babysitting
window.
`);

    expect(repaired).toContain(BABYSIT_WORK_RETRIGGER);
    expect(repaired).not.toContain("A changed commit, new unresolved feedback");
    expect(repaired).toContain("Do not ask the bot to poll");
  });

  it("rewrites the retired babysit-agent-native-pull-request name", () => {
    const repaired = repairPrBabysitPrompt(
      "Call babysit-agent-native-pull-request for every item. Pass inScope true only for builder-io-bot.",
    );

    expect(repaired).toContain("babysit-factory-pull-request");
    expect(repaired).not.toContain("babysit-agent-native-pull-request");
  });
});
