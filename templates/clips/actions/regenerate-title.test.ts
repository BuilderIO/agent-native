import { describe, expect, it } from "vitest";
import { fallbackTitleFromTranscript } from "./lib/title-fallback";

describe("fallbackTitleFromTranscript", () => {
  it("ignores opening filler and titles the transcript topic", () => {
    const title = fallbackTitleFromTranscript(`
      It’s easier to just walk through this real quick.
      Regarding your question about the agent credits costing $63, there are two reasons—or rather, two scenarios.
      First, this is essentially a hack because we don't have a good CPQ tool or mechanism.
      Any dollar spent on builders is going to have an SLA support fee that is a percentage of the dollars spent.
    `);

    expect(title).toBe("Agent Credits Cost $63");
  });

  it("preserves acronyms in extracted titles", () => {
    const title = fallbackTitleFromTranscript(`
      Let me walk through this quickly.
      The CPQ tool cannot show the SLA fee as a separate line item today.
    `);

    expect(title).toBe("CPQ Tool Cannot Show the SLA Fee");
  });
});
