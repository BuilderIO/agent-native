import { describe, expect, it } from "vitest";

import { isShareableContentPath } from "./root";

describe("isShareableContentPath", () => {
  it("classifies a shared deck link as shareable content", () => {
    // Regression for the Adam/Tim report: opening `/deck/:id` from a shared
    // link briefly showed the deck, then the first-run onboarding gate took
    // over because this classifier only recognized `/share/` and `/p/`.
    expect(isShareableContentPath("/deck/abc123")).toBe(true);
  });

  it("classifies the full-screen presentation route as shareable content", () => {
    expect(isShareableContentPath("/deck/abc123/present")).toBe(true);
  });

  it("classifies the agent-embed slide preview as shareable content", () => {
    expect(isShareableContentPath("/slide")).toBe(true);
  });

  it("still classifies the existing bare prefixes as shareable content", () => {
    expect(isShareableContentPath("/share/tok123")).toBe(true);
    expect(isShareableContentPath("/p/abc123")).toBe(true);
  });

  it("does not classify app-management surfaces as shareable content", () => {
    expect(isShareableContentPath("/")).toBe(false);
    expect(isShareableContentPath("/settings/agent")).toBe(false);
    expect(isShareableContentPath("/team")).toBe(false);
  });
});
