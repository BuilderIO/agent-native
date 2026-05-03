import { describe, expect, it } from "vitest";
import listDocs from "./list-docs";
import readDoc from "./read-doc";
import searchDocs from "./search-docs";

describe("docs actions", () => {
  it("lists the current core docs content", async () => {
    const output = await listDocs.run({});

    expect(output).toContain("[Getting Started](/docs)");
    expect(output).toContain("[Onboarding & API Keys](/docs/onboarding)");
    expect(output).toContain("[Workspace](/docs/workspace)");
    expect(output).toContain("[Mail](/docs/template-mail)");
  });

  it("reads docs from the core docs source", async () => {
    const output = await readDoc.run({ slug: "onboarding" });

    expect(output).toContain("# Onboarding");
    expect(output).toContain("registerOnboardingStep");
  });

  it("searches docs that are not in the stale public markdown copy", async () => {
    const output = await searchDocs.run({ query: "registerOnboardingStep" });

    expect(output).toContain("Onboarding");
    expect(output).toContain("**Path:** /docs/onboarding");
  });
});
