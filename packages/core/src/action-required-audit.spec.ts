import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  bestEffort: vi.fn(),
  required: vi.fn(),
}));

vi.mock("./audit/record.js", () => ({
  recordActionAudit: (...args: unknown[]) => mocks.bestEffort(...args),
  recordRequiredActionAudit: (...args: unknown[]) => mocks.required(...args),
}));

import { defineAction } from "./action";

describe("required action audit", () => {
  it("does not release a result when the mandatory receipt fails", async () => {
    mocks.required.mockRejectedValueOnce(new Error("audit unavailable"));
    const action = defineAction({
      description: "Sensitive read",
      schema: z.object({}),
      readOnly: true,
      audit: { required: true, onRead: true },
      run: async () => ({ secret: "result" }),
    });

    await expect(
      action.run({}, { caller: "frontend", actionName: "sensitive-read" }),
    ).rejects.toThrow("audit unavailable");
  });

  it("preserves best-effort behavior for ordinary audit events", async () => {
    mocks.bestEffort.mockRejectedValueOnce(new Error("audit unavailable"));
    const action = defineAction({
      description: "Ordinary write",
      schema: z.object({}),
      run: async () => ({ ok: true }),
    });

    await expect(
      action.run({}, { caller: "frontend", actionName: "ordinary-write" }),
    ).resolves.toEqual({ ok: true });
  });
});
