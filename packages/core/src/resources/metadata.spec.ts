import { describe, expect, it } from "vitest";

import {
  getRemoteAgentIdFromPath,
  getResourceKind,
  getSkillNameFromPath,
  isSkillPath,
  isRemoteAgentPath,
  parseRemoteAgentManifest,
  parseRemoteAgentUrl,
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

  it("preserves custom card URLs and vault-backed auth references", () => {
    const manifest = parseRemoteAgentManifest(
      JSON.stringify({
        id: "foundry-qa",
        name: "Foundry QA",
        url: "https://foundry.example.com",
        cardUrl:
          "https://foundry.example.com/agents/qa/endpoint/protocols/a2a/agentCard/v1.0",
        auth: {
          type: "oauth-client-credentials",
          tokenUrl: "https://login.example.com/oauth2/token",
          clientId: "client-id",
          clientSecretRef: "FOUNDRY_CLIENT_SECRET",
          scope: "https://ai.azure.com/.default",
        },
      }),
      "remote-agents/foundry-qa.json",
    );

    expect(manifest).toMatchObject({
      id: "foundry-qa",
      cardUrl:
        "https://foundry.example.com/agents/qa/endpoint/protocols/a2a/agentCard/v1.0",
      auth: {
        type: "oauth-client-credentials",
        tokenUrl: "https://login.example.com/oauth2/token",
        clientId: "client-id",
        clientSecretRef: "FOUNDRY_CLIENT_SECRET",
        scope: "https://ai.azure.com/.default",
      },
    });
  });

  it("rejects auth entries that contain values instead of references", () => {
    expect(
      parseRemoteAgentManifest(
        JSON.stringify({
          url: "https://agent.example.com",
          auth: { type: "bearer", credentialRef: "" },
        }),
        "remote-agents/invalid-auth.json",
      ),
    ).toBeNull();
    expect(
      parseRemoteAgentManifest(
        JSON.stringify({
          url: "https://agent.example.com",
          auth: {
            type: "oauth-client-credentials",
            tokenUrl: "https://login.example.com/token",
            clientId: "client-id",
            clientSecretRef: "",
          },
        }),
        "remote-agents/invalid-oauth.json",
      ),
    ).toBeNull();
  });

  it("requires HTTPS for credential-bearing hosted URLs", () => {
    expect(parseRemoteAgentUrl("http://agent.example.test/card")).toBe(
      "http://agent.example.test/card",
    );
    expect(
      parseRemoteAgentUrl("http://agent.example.test/card", {
        requireHttps: true,
        allowLoopbackHttp: true,
      }),
    ).toBeUndefined();
    expect(
      parseRemoteAgentManifest(
        JSON.stringify({
          url: "http://agent.example.test",
          auth: { type: "bearer", credentialRef: "TOKEN" },
        }),
        "remote-agents/insecure.json",
      ),
    ).toBeNull();
    expect(
      parseRemoteAgentManifest(
        JSON.stringify({
          url: "https://agent.example.test",
          auth: {
            type: "oauth-client-credentials",
            tokenUrl: "http://login.example.test/token",
            clientId: "client",
            clientSecretRef: "SECRET",
          },
        }),
        "remote-agents/insecure-oauth.json",
      ),
    ).toBeNull();
    expect(
      parseRemoteAgentManifest(
        JSON.stringify({
          url: "http://127.0.0.1:8787",
          cardUrl: "http://127.0.0.1:8787/card",
          auth: { type: "bearer", credentialRef: "TOKEN" },
        }),
        "remote-agents/local.json",
      ),
    ).toMatchObject({ url: "http://127.0.0.1:8787" });
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
