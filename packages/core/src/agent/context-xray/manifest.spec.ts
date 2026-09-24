import { describe, expect, it } from "vitest";

import {
  manifestConversationTokens,
  manifestSystemTokens,
  type ContextManifest,
} from "../../shared/context-xray.js";
import type { EngineMessage } from "../engine/types.js";
import { buildManifest, buildSystemManifestSections } from "./manifest.js";

describe("context-xray system sections", () => {
  it("counts, labels, hashes, and bounds system previews", async () => {
    const sections = await buildSystemManifestSections([
      {
        label: "Enterprise policy",
        provenance: "enterprise-workspace-core",
        governance: "required",
        content: "Follow the enterprise security policy.",
        sourceRef: { path: "AGENTS.md", scope: "workspace" },
      },
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      kind: "system",
      label: "Enterprise policy",
      provenance: "enterprise-workspace-core",
      governance: "required",
      sourceRef: { path: "AGENTS.md", scope: "workspace" },
    });
    expect(sections[0]?.tokenCount).toBeGreaterThan(0);
    expect(sections[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sections[0]?.preview.length).toBeLessThanOrEqual(200);
  });

  it("adds system cost without changing conversation reclaim semantics", async () => {
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ];
    const sections = await buildSystemManifestSections([
      {
        label: "Framework",
        provenance: "framework-core",
        governance: "required",
        content: "Framework rules",
      },
    ]);
    const manifest = await buildManifest({
      threadId: "thread-1",
      rawMessages: messages,
      sentMessages: messages,
      appliedStatus: new Map(),
      directives: new Map(),
      systemSections: sections,
    });

    expect(manifest.systemTokens).toBe(sections[0]?.tokenCount);
    expect(manifest.conversationTokens).toBeGreaterThan(0);
    expect(manifest.totalTokens).toBe(
      (manifest.systemTokens ?? 0) + (manifest.conversationTokens ?? 0),
    );
    expect(manifest.reclaimedTokens).toBe(0);
  });

  it("loads old conversation-only manifests as backward-compatible data", () => {
    const oldManifest = {
      threadId: "old-thread",
      computedAt: 1,
      totalTokens: 42,
      rawTokens: 50,
      reclaimedTokens: 8,
      tokenCountMethod: "estimate",
      source: "structured",
      enforceable: true,
      segments: [],
    } as ContextManifest;

    expect(manifestSystemTokens(oldManifest)).toBe(0);
    expect(manifestConversationTokens(oldManifest)).toBe(42);
    expect(oldManifest.systemSections).toBeUndefined();
  });
});
