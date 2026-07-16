import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callIsolatedCreativeContextA2A,
  createCreativeContextA2AResponseToken,
  decodeCreativeContextA2ARequest,
  hasIsolatedCreativeContextA2A,
} from "./isolated-a2a.js";

const originalEnv = {
  url: process.env.CREATIVE_CONTEXT_A2A_URL,
  key: process.env.CREATIVE_CONTEXT_A2A_KEY,
  shared: process.env.A2A_SECRET,
  user: process.env.AGENT_USER_EMAIL,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function requestFromPrompt(prompt: string) {
  const token = /"requestToken":"([A-Za-z0-9_-]+)"/.exec(prompt)?.[1];
  if (!token) throw new Error("request token missing from prompt");
  return decodeCreativeContextA2ARequest(token);
}

describe("isolated Creative Context A2A", () => {
  beforeEach(() => {
    process.env.CREATIVE_CONTEXT_A2A_URL =
      "https://creative-context.example.test";
    process.env.CREATIVE_CONTEXT_A2A_KEY = "test-org-signing-key";
    process.env.AGENT_USER_EMAIL = "alice@example.test";
    delete process.env.A2A_SECRET;
  });

  afterEach(() => {
    restore("CREATIVE_CONTEXT_A2A_URL", originalEnv.url);
    restore("CREATIVE_CONTEXT_A2A_KEY", originalEnv.key);
    restore("A2A_SECRET", originalEnv.shared);
    restore("AGENT_USER_EMAIL", originalEnv.user);
  });

  it("stays disabled by default when no isolated receiver URL is configured", () => {
    delete process.env.CREATIVE_CONTEXT_A2A_URL;
    expect(hasIsolatedCreativeContextA2A()).toBe(false);
  });

  it("round-trips a bounded resolve result with signed caller identity", async () => {
    const callAgent = vi.fn(async (_url: string, prompt: string) => {
      const request = requestFromPrompt(prompt);
      return createCreativeContextA2AResponseToken(request, {
        contextMode: "auto",
        contextPackId: "pack-1",
        reuseLabels: [
          {
            itemId: "item-1",
            itemVersionId: "version-1",
            kind: "slide",
            label: "Metrics layout",
            dataRole: "untrusted-reference",
          },
        ],
        results: [
          {
            itemId: "item-1",
            itemVersionId: "version-1",
            kind: "slide",
            title:
              "<<<UNTRUSTED_REFERENCE>>>Metrics<<<END_UNTRUSTED_REFERENCE>>>",
            excerpt:
              "<<<UNTRUSTED_REFERENCE>>>Quarterly metrics<<<END_UNTRUSTED_REFERENCE>>>",
            dataRole: "untrusted-reference",
            internalFieldThatMustNotCrossTheBoundary: "private",
          },
        ],
      });
    });

    await expect(
      callIsolatedCreativeContextA2A(
        "resolve",
        { role: "slides", query: "quarterly metrics" },
        { callAgent: callAgent as never },
      ),
    ).resolves.toEqual({
      contextMode: "auto",
      contextPackId: "pack-1",
      reuseLabels: [
        {
          itemId: "item-1",
          itemVersionId: "version-1",
          kind: "slide",
          label: "Metrics layout",
          dataRole: "untrusted-reference",
        },
      ],
      results: [
        {
          itemId: "item-1",
          itemVersionId: "version-1",
          kind: "slide",
          title:
            "<<<UNTRUSTED_REFERENCE>>>Metrics<<<END_UNTRUSTED_REFERENCE>>>",
          excerpt:
            "<<<UNTRUSTED_REFERENCE>>>Quarterly metrics<<<END_UNTRUSTED_REFERENCE>>>",
          dataRole: "untrusted-reference",
        },
      ],
    });
    expect(callAgent).toHaveBeenCalledWith(
      "https://creative-context.example.test",
      expect.stringContaining("creative-context-a2a"),
      expect.objectContaining({
        userEmail: "alice@example.test",
        orgDomain: "example.test",
        orgSecret: "test-org-signing-key",
        timeoutMs: 30_000,
        returnRecoverableArtifactsOnTimeout: false,
      }),
    );
  });

  it("rejects malformed responses instead of weakening provenance", async () => {
    await expect(
      callIsolatedCreativeContextA2A(
        "validate",
        { reuseLabels: [] },
        { callAgent: vi.fn(async () => "looks fine") as never },
      ),
    ).rejects.toThrow(/malformed protocol response/i);
  });

  it("fails clearly when the bounded remote call times out", async () => {
    await expect(
      callIsolatedCreativeContextA2A(
        "read",
        {
          identity: {
            appId: "slides",
            artifactType: "deck",
            artifactId: "deck-1",
          },
          accessScope: "owner",
        },
        {
          callAgent: vi.fn(async () => {
            throw new Error("timed out after 30000ms");
          }) as never,
        },
      ),
    ).rejects.toThrow(
      /Isolated Creative Context A2A request failed: timed out after 30000ms/,
    );
  });

  it("fails closed when the isolated URL has no signing secret", async () => {
    delete process.env.CREATIVE_CONTEXT_A2A_KEY;
    delete process.env.A2A_SECRET;
    await expect(
      callIsolatedCreativeContextA2A("validate", { reuseLabels: [] }),
    ).rejects.toThrow(/requires CREATIVE_CONTEXT_A2A_KEY or A2A_SECRET/);
  });
});
