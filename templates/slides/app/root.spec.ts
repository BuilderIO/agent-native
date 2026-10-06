import { describe, expect, it } from "vitest";

import { isBareContentPath, isDeckEditorPath } from "./root";

describe("session and content route policy", () => {
  it("requires a session for the editor while skipping startup onboarding", () => {
    expect(isBareContentPath("/deck/abc123")).toBe(false);
    expect(isDeckEditorPath("/deck/abc123")).toBe(true);
  });

  it("classifies the full-screen presentation route as shareable content", () => {
    expect(isBareContentPath("/deck/abc123/present/")).toBe(true);
    expect(isDeckEditorPath("/deck/abc123/present")).toBe(false);
    expect(isDeckEditorPath("/deck/abc123/present/")).toBe(false);
  });

  it("classifies the agent-embed slide preview as shareable content", () => {
    expect(isBareContentPath("/slide/")).toBe(true);
  });

  it("still classifies the existing bare prefixes as shareable content", () => {
    expect(isBareContentPath("/share/tok123")).toBe(true);
    expect(isBareContentPath("/p/abc123")).toBe(true);
  });

  it("does not classify app-management surfaces as shareable content", () => {
    expect(isBareContentPath("/")).toBe(false);
    expect(isBareContentPath("/settings/agent")).toBe(false);
    expect(isBareContentPath("/team")).toBe(false);
  });
});
