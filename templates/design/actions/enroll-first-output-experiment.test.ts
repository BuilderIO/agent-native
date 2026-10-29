import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: { authUserId: "user-1" },
  access: vi.fn(),
  receipt: vi.fn(),
  insert: vi.fn(),
  get: vi.fn(),
  track: vi.fn(),
}));
vi.mock("@agent-native/core/action", () => ({
  defineAction: (value: unknown) => value,
  fail: (message: string) => {
    throw new Error(message);
  },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("../server/db/index.js", () => ({
  schema: { firstOutputExperimentClaims: { userId: "userId" } },
  getDb: () => ({
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoNothing: () => ({ returning: () => mocks.insert(values) }),
      }),
    }),
    select: () => ({
      from: () => ({ where: () => ({ limit: () => mocks.get() }) }),
    }),
  }),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () => mocks.context,
}));
vi.mock("@agent-native/core/sharing", () => ({ resolveAccess: mocks.access }));
vi.mock("./get-design-generation-output.js", () => ({
  default: { run: mocks.receipt },
}));
vi.mock("../server/lib/design-tracking.js", () => ({
  trackDesign: mocks.track,
}));

import action from "./enroll-first-output-experiment.js";

const args = { outputId: "design-1", runId: "run-1", turnId: "turn-1" };
describe("first output experiment enrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ role: "owner" });
    mocks.receipt.mockResolvedValue({ status: "has_output" });
    mocks.insert.mockResolvedValue([{ userId: "user-1" }]);
    mocks.get.mockResolvedValue([
      {
        userId: "user-1",
        variant: "control",
        outputId: "other",
        turnId: "other",
      },
    ]);
  });
  it("enrolls only a verified owner and records the assigned arm", async () => {
    const result = await action.run(args);
    expect(["control", "next_step"]).toContain(result.variant);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        variant: result.variant,
        outputId: args.outputId,
        turnId: args.turnId,
      }),
    );
    expect(mocks.track).toHaveBeenCalledWith(
      "first_output_next_step_exposed",
      expect.objectContaining({
        experiment_variant: result.variant,
        output_id: "design-1",
      }),
      undefined,
    );
  });
  it("recovers the same eligible output after a lost response", async () => {
    const initial = await action.run(args);
    mocks.insert.mockResolvedValue([]);
    mocks.get.mockResolvedValue([
      {
        userId: "user-1",
        variant: initial.variant,
        outputId: args.outputId,
        turnId: args.turnId,
      },
    ]);
    expect(await action.run(args)).toEqual(initial);
    expect(mocks.track).toHaveBeenCalledTimes(1);
  });
  it("reports uncertain output verification as retryable instead of a control outcome", async () => {
    mocks.receipt.mockResolvedValue({ status: "unknown" });
    await expect(action.run(args)).rejects.toThrow(
      "Generation output verification is temporarily unavailable",
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("does not enroll a non-owner, unverified output, or a prior enrollee", async () => {
    mocks.access.mockResolvedValueOnce({ role: "editor" });
    expect(await action.run(args)).toEqual({ variant: null });
    expect(mocks.insert).not.toHaveBeenCalled();
    mocks.receipt.mockResolvedValueOnce({ status: "no_output" });
    expect(await action.run(args)).toEqual({ variant: null });
    expect(mocks.insert).not.toHaveBeenCalled();
    mocks.insert.mockResolvedValueOnce([]);
    expect(await action.run(args)).toEqual({ variant: null });
    expect(mocks.track).not.toHaveBeenCalled();
  });
});
