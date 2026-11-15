import { describe, expect, it, vi } from "vitest";

import type { AgentTransport, ForkThreadInput } from "../protocol/index.js";
import { AgentKitClient } from "./client.js";

describe("controller fork boundary contract", () => {
  it("forwards exclusive boundaries and refuses ambiguity before reaching transport", async () => {
    const forkThread = vi.fn(async (_input: ForkThreadInput) => ({
      id: "fork",
      createdAt: "2026-11-07T00:00:00.000Z",
      updatedAt: "2026-11-07T00:00:00.000Z",
    }));
    const transport: AgentTransport = {
      capabilities: { threadForking: true },
      forkThread,
      async startRun() {
        return { runId: "run" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
    };
    const client = new AgentKitClient({
      transport,
      aiSetupReadiness: "not-applicable",
    });
    try {
      await client.forkThread("source", undefined, {
        beforeMessageId: "first",
      });
      expect(forkThread).toHaveBeenCalledWith(
        {
          threadId: "source",
          fromMessageId: undefined,
          beforeMessageId: "first",
        },
        expect.anything(),
      );
      forkThread.mockClear();
      await expect(
        client.forkThread("source", "inclusive", { beforeMessageId: "first" }),
      ).rejects.toThrow("mutually exclusive");
      await expect(
        client.forkThread("source", undefined, { beforeMessageId: "" }),
      ).rejects.toThrow();
      expect(forkThread).not.toHaveBeenCalled();
    } finally {
      await client.shutdown();
    }
  });
});
