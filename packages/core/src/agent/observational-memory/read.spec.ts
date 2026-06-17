import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EngineMessage } from "../engine/types.js";

const storeMod = vi.hoisted(() => ({
  listObservationalMemory: vi.fn(),
}));
vi.mock("./store.js", () => storeMod);

const { buildObservationalContext } = await import("./read.js");

function msg(role: "user" | "assistant", text: string): EngineMessage {
  return { role, content: [{ type: "text", text }] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildObservationalContext", () => {
  it("returns the 3-tier structure: reflections + observations + recent raw messages", async () => {
    storeMod.listObservationalMemory.mockImplementation(
      async (opts: { tier?: string }) => {
        if (opts.tier === "reflection") {
          return [
            { id: "r1", tier: "reflection", text: "REFL", tokenEstimate: 30 },
          ];
        }
        if (opts.tier === "observation") {
          return [
            { id: "o1", tier: "observation", text: "OBS-1", tokenEstimate: 50 },
            { id: "o2", tier: "observation", text: "OBS-2", tokenEstimate: 70 },
          ];
        }
        return [];
      },
    );

    const messages: EngineMessage[] = [
      msg("user", "old-1"),
      msg("assistant", "old-2"),
      msg("user", "recent-A"),
      msg("assistant", "recent-B"),
    ];

    const ctx = await buildObservationalContext({
      threadId: "t1",
      ownerEmail: "alice@example.com",
      messages,
      config: { recentRawMessageCount: 2 },
    });

    // Three tiers present.
    expect(ctx.reflections.map((e) => e.text)).toEqual(["REFL"]);
    expect(ctx.observations.map((e) => e.text)).toEqual(["OBS-1", "OBS-2"]);
    expect(ctx.recentMessages).toHaveLength(2);
    expect(ctx.recentMessages[0].content[0]).toMatchObject({
      text: "recent-A",
    });
    expect(ctx.recentMessages[1].content[0]).toMatchObject({
      text: "recent-B",
    });

    // Token accounting sums each tier.
    expect(ctx.tokens.reflections).toBe(30);
    expect(ctx.tokens.observations).toBe(120);
    expect(ctx.tokens.recentMessages).toBeGreaterThan(0);
    expect(ctx.tokens.total).toBe(
      ctx.tokens.reflections +
        ctx.tokens.observations +
        ctx.tokens.recentMessages,
    );
  });

  it("scopes the store reads by owner", async () => {
    storeMod.listObservationalMemory.mockResolvedValue([]);

    await buildObservationalContext({
      threadId: "t1",
      ownerEmail: "bob@example.com",
      messages: [msg("user", "hi")],
    });

    for (const call of storeMod.listObservationalMemory.mock.calls) {
      expect(call[0].ownerEmail).toBe("bob@example.com");
      expect(call[0].threadId).toBe("t1");
    }
  });
});
