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
});
