import { describe, expect, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({
  getDb: () => {
    throw new Error("the production database must not be read in this spec");
  },
}));

import { createTripwireSink } from "./index.js";
import type { TripwireEvent, TripwireScope } from "./types.js";

const SCOPE: TripwireScope = { orgId: "org-1", factoryId: "factory-1" };

describe("createTripwireSink", () => {
  it("fills in the factory and the default workflow, and lets an event name its own", () => {
    const record = vi.fn();
    const sink = createTripwireSink({
      scope: SCOPE,
      workflowId: "wf-1",
      recorder: { record },
    });
    sink({ area: "ai", code: "ai_slow", severity: "info", details: { ms: 9 } });
    sink({
      area: "ai",
      code: "ai_slow",
      severity: "info",
      workflowId: "wf-2",
    });

    expect(record).toHaveBeenNthCalledWith(1, {
      area: "ai",
      code: "ai_slow",
      severity: "info",
      details: { ms: 9 },
      scope: SCOPE,
      workflowId: "wf-1",
    });
    expect((record.mock.calls[1]![0] as TripwireEvent).workflowId).toBe("wf-2");
  });

  it("cannot be pointed at another factory by the event it is handed", () => {
    const record = vi.fn();
    const sink = createTripwireSink({ scope: SCOPE, recorder: { record } });
    sink({
      area: "merge",
      code: "merge_blocked",
      severity: "warn",
      scope: { orgId: "org-2", factoryId: "factory-9" },
    } as never);
    expect((record.mock.calls[0]![0] as TripwireEvent).scope).toEqual(SCOPE);
  });

  it("never throws into the caller, and says so when the recorder does", () => {
    const failure = vi.spyOn(console, "error").mockImplementation(() => {});
    const sink = createTripwireSink({
      scope: SCOPE,
      recorder: {
        record: () => {
          throw new Error("recorder is down");
        },
      },
    });
    expect(() =>
      sink({ area: "ai", code: "ai_slow", severity: "info" }),
    ).not.toThrow();
    expect(failure).toHaveBeenCalledWith(
      expect.stringContaining("[factory-tripwire-failed]"),
    );
    failure.mockRestore();
  });
});
