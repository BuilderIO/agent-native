import { describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../../../server/request-context.js";

const callerOwnsThreadMock = vi.hoisted(() => vi.fn());

vi.mock("../../run-ownership.js", () => ({
  callerOwnsThread: (...args: unknown[]) => callerOwnsThreadMock(...args),
}));

describe("Context X-Ray action errors", () => {
  it("throws 401 errors for missing auth", async () => {
    const actions = await Promise.all([
      import("./context-manifest-get.js"),
      import("./context-pin.js"),
      import("./context-evict.js"),
      import("./context-restore.js"),
      import("./context-report.js"),
    ]);

    await runWithRequestContext({}, async () => {
      for (const action of actions) {
        await expect(
          action.default.run({
            threadId: "thread-1",
            segmentId: "segment-1",
            segments: [],
          }),
        ).rejects.toMatchObject({
          message: "Context X-Ray requires a signed-in user.",
          statusCode: 401,
        });
      }
    });
  });

  it("throws 404 errors for ownership-gated thread misses", async () => {
    callerOwnsThreadMock.mockResolvedValue(false);
    const pinAction = (await import("./context-pin.js")).default;
    const manifestAction = (await import("./context-manifest-get.js")).default;

    await runWithRequestContext(
      { userEmail: "owner@example.com" },
      async () => {
        await expect(
          pinAction.run({ threadId: "thread-1", segmentId: "segment-1" }),
        ).rejects.toMatchObject({
          message: "Thread not found.",
          statusCode: 404,
        });
        await expect(
          manifestAction.run({ threadId: "thread-1" }),
        ).rejects.toMatchObject({
          message: "Thread not found.",
          statusCode: 404,
        });
      },
    );

    expect(callerOwnsThreadMock).toHaveBeenCalledWith(
      "owner@example.com",
      "thread-1",
    );
    expect(callerOwnsThreadMock).toHaveBeenCalledTimes(2);
  });
});
