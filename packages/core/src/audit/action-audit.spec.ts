import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Intercept the DB-touching recorder that the defineAction audit wrapper loads
// lazily. Resolves to the same module the wrapper imports (`./audit/record.js`
// from action.ts == this directory's record.js).
const recordActionAudit = vi.fn(async () => {});
vi.mock("./record.js", () => ({ recordActionAudit }));

const { defineAction } = await import("../action.js");

beforeEach(() => recordActionAudit.mockClear());
afterEach(() => vi.clearAllMocks());

describe("defineAction audit wrapper", () => {
  it("records a mutating action and threads the dispatch context", async () => {
    const action = defineAction({
      description: "delete a thing",
      run: async (args: { id: string }) => ({ deleted: args.id }),
    });

    const result = await action.run(
      { id: "t1" },
      { caller: "tool", actionName: "delete-thing", userEmail: "a@x.com" },
    );

    expect(result).toEqual({ deleted: "t1" }); // result preserved
    expect(recordActionAudit).toHaveBeenCalledTimes(1);
    const call = recordActionAudit.mock.calls[0][0] as any;
    expect(call.status).toBe("success");
    expect(call.ctx.actionName).toBe("delete-thing");
    expect(call.result).toEqual({ deleted: "t1" });
  });

  it("records errors as status:error and rethrows the original error", async () => {
    const action = defineAction({
      description: "explode",
      run: async () => {
        throw new Error("kaboom");
      },
    });

    await expect(
      action.run({}, { caller: "tool", actionName: "explode" }),
    ).rejects.toThrow("kaboom");

    const call = recordActionAudit.mock.calls[0][0] as any;
    expect(call.status).toBe("error");
    expect(call.error).toBeInstanceOf(Error);
  });

  it("does not audit read-only (GET) actions by default", async () => {
    const action = defineAction({
      description: "list things",
      http: { method: "GET" },
      run: async () => ({ items: [] }),
    });

    await action.run({}, { caller: "frontend", actionName: "list-things" });
    expect(recordActionAudit).not.toHaveBeenCalled();
  });

  it("audits a read-only action that opts in via audit.onRead", async () => {
    const action = defineAction({
      description: "read a secret",
      http: { method: "GET" },
      audit: { onRead: true },
      run: async () => ({ ok: true }),
    });

    await action.run({}, { caller: "tool", actionName: "read-secret" });
    expect(recordActionAudit).toHaveBeenCalledTimes(1);
  });

  it("does not audit a mutating action explicitly disabled", async () => {
    const action = defineAction({
      description: "noisy sync",
      audit: { enabled: false },
      run: async () => ({ ok: true }),
    });

    await action.run({}, { caller: "tool", actionName: "noisy-sync" });
    expect(recordActionAudit).not.toHaveBeenCalled();
  });
});
