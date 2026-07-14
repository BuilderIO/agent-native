import { describe, expect, it } from "vitest";

import listDocs from "./list-docs";
import readDoc from "./read-doc";
import readSourceFile from "./read-source-file";
import searchDocs from "./search-docs";
import searchSource from "./search-source";

describe("docs actions", () => {
  it("marks documentation reads and searches as read-only", () => {
    expect(
      [listDocs, readDoc, readSourceFile, searchDocs, searchSource].map(
        (action) => action.readOnly,
      ),
    ).toEqual([true, true, true, true, true]);
  });

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

  it("finds Clips browser logging guidance", async () => {
    const output = await searchDocs.run({ query: "browser logs" });

    expect(output).toContain("Clips");
    expect(output).toContain("Browser logs and developer diagnostics");
    expect(output).toContain("**Path:** /docs/template-clips");
  });
});
