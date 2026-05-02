import { describe, expect, it } from "vitest";
import {
  BUILTIN_AGENTS_FOR_SEEDING,
  getBuiltinAgents,
} from "./agent-discovery.js";
import { visibleTemplates } from "../cli/templates-meta.js";

describe("agent discovery", () => {
  it("derives built-in connected agents from visible production templates", () => {
    const expected = visibleTemplates()
      .filter((template) => template.prodUrl && template.name !== "dispatch")
      .map((template) => template.name);

    expect(getBuiltinAgents("dispatch").map((agent) => agent.id)).toEqual(
      expected,
    );
  });

  it("includes current public agents and excludes hidden production agents", () => {
    const ids = getBuiltinAgents("dispatch").map((agent) => agent.id);

    expect(ids).toContain("clips");
    expect(ids).toContain("design");
    expect(ids).not.toContain("issues");
    expect(ids).not.toContain("recruiting");
    expect(ids).not.toContain("calls");
    expect(ids).not.toContain("meeting-notes");
    expect(ids).not.toContain("scheduling");
    expect(ids).not.toContain("voice");
  });

  it("seeds built-in remote agents with production URLs only", () => {
    for (const agent of BUILTIN_AGENTS_FOR_SEEDING) {
      expect(agent.url).toMatch(/^https:\/\/.+\.agent-native\.com$/);
      expect(agent.url).not.toContain("localhost");
      expect(agent.url).not.toContain("127.0.0.1");
    }
  });
});
