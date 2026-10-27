import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { AuditEvent } from "./types.js";

const insertAuditEvent = vi.fn<(e: AuditEvent) => Promise<void>>();

vi.mock("./store.js", () => ({
  insertAuditEvent: (e: AuditEvent) => insertAuditEvent(e),
}));
vi.mock("../server/request-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/request-context.js")>()),
  getIntegrationRequestContext: () => undefined,
}));

const { defineAction } = await import("../action.js");

const action = defineAction({
  description: "attach usage to a recap",
  schema: z.object({ planId: z.string().min(1), model: z.string().min(1) }),
  run: async (args) => {
    if (args.planId === "missing") throw new Error("Plan missing not found");
    return { planId: args.planId };
  },
});

const ctx = { caller: "http", actionName: "record-recap-usage" } as const;

beforeEach(() => {
  insertAuditEvent.mockReset();
  insertAuditEvent.mockResolvedValue(undefined);
});

describe("a rejected capability probe through a real action", () => {
  it("is not audited as a failure", async () => {
    await expect(action.run({ __probe__: true } as any, ctx)).rejects.toThrow();
    expect(insertAuditEvent).not.toHaveBeenCalled();
  });

  it("still audits an invalid call that is not a probe", async () => {
    await expect(
      action.run({ planId: "__probe__" } as any, ctx),
    ).rejects.toThrow();
    expect(insertAuditEvent).toHaveBeenCalledTimes(1);
    expect(insertAuditEvent.mock.calls[0][0].status).toBe("error");
  });

  it("still audits a real failure", async () => {
    await expect(
      action.run({ planId: "missing", model: "m" }, ctx),
    ).rejects.toThrow("Plan missing not found");
    expect(insertAuditEvent.mock.calls[0][0].status).toBe("error");
  });
});
