import { describe, expect, it } from "vitest";

import {
  getRemoteAgentIdFromPath,
  getResourceKind,
  getSkillNameFromPath,
  isSkillPath,
  isRemoteAgentPath,
  parseRemoteAgentManifest,
  remoteAgentResourcePath,
} from "./metadata.js";

describe("resource metadata", () => {
  it("treats remote-agents/*.json as the canonical remote-agent path", () => {
    expect(remoteAgentResourcePath("qa-agent")).toBe(
      "remote-agents/qa-agent.json",
    );
    expect(isRemoteAgentPath("remote-agents/qa-agent.json")).toBe(true);
    expect(getResourceKind("remote-agents/qa-agent.json")).toBe("remote-agent");
  });

  it("continues to recognize legacy agents/*.json remote-agent manifests", () => {
    const manifest = parseRemoteAgentManifest(
      JSON.stringify({
        name: "Legacy QA",
        url: "https://qa.example.com",
      }),
      "agents/legacy-qa.json",
    );

    expect(isRemoteAgentPath("agents/legacy-qa.json")).toBe(true);
    expect(getResourceKind("agents/legacy-qa.json")).toBe("remote-agent");
    expect(getRemoteAgentIdFromPath("agents/legacy-qa.json")).toBe("legacy-qa");
    expect(manifest).toMatchObject({
      id: "legacy-qa",
      path: "agents/legacy-qa.json",
      name: "Legacy QA",
      url: "https://qa.example.com",
    });
  });

  it("keeps markdown agents classified as local custom agents", () => {
    expect(isRemoteAgentPath("agents/researcher.md")).toBe(false);
    expect(getResourceKind("agents/researcher.md")).toBe("agent");
  });

  it("classifies agent-pack skills without treating reference files as agents", () => {
    expect(isSkillPath("agents/researcher/skills/interviews/SKILL.md")).toBe(
      true,
    );
    expect(
      getSkillNameFromPath("agents/researcher/skills/interviews/SKILL.md"),
    ).toBe("interviews");
    expect(
      getResourceKind("agents/researcher/skills/interviews/SKILL.md"),
    ).toBe("skill");
    expect(getResourceKind("agents/researcher/context/brief.md")).toBe("file");
    expect(getResourceKind("agents/researcher.md")).toBe("agent");
  });
});
