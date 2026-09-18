import { describe, expect, it } from "vitest";

import { featuredTemplateSlugs, getTemplate, templates } from "./template-data";

describe("community template gallery", () => {
  it("keeps Geoff's ongoing shortlist represented by runnable templates", () => {
    expect(featuredTemplateSlugs).toHaveLength(9);
    expect(
      featuredTemplateSlugs.every((slug) => getTemplate(slug).slug === slug),
    ).toBe(true);
    expect(templates).toHaveLength(10);
  });

  it("falls back to the workflow discovery template", () => {
    expect(getTemplate("missing-template").slug).toBe("agent-advisor");
  });

  it("keeps draft content associated with its selected record", () => {
    const callFollowUp = getTemplate("call-follow-up-drafter");
    const northstarDraft = callFollowUp.draft?.variants?.["northstar-call"];

    expect(northstarDraft?.recipient).toContain("Northstar Labs");
    expect(northstarDraft?.subject).toContain("Northstar");
    expect(northstarDraft?.body.join(" ")).toContain("procurement timing");
  });

  it("keys memo and queue evidence to the selected record", () => {
    const winLoss = getTemplate("win-loss-memo");
    const orbitMemo = winLoss.memo?.variants?.["orbit-loss"];
    const accountTiering = getTemplate("account-tiering");
    const northstarEvidence =
      accountTiering.sectionsByRowId?.["northstar-labs"];

    expect(orbitMemo?.headline).toContain("Orbit");
    expect(orbitMemo?.evidence.join(" ")).toContain("economic buyer");
    expect(northstarEvidence?.[0].value).toContain("Champion");
  });
});
