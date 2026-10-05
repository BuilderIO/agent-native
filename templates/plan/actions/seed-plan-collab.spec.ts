import { beforeEach, describe, expect, it, vi } from "vitest";

const { assertPlanEditor, seedXmlFragmentIfEmpty } = vi.hoisted(() => ({
  assertPlanEditor: vi.fn(),
  seedXmlFragmentIfEmpty: vi.fn(),
}));

vi.mock("../server/plans.js", () => ({ assertPlanEditor }));
vi.mock("@agent-native/core/collab", () => ({
  base64ToUint8Array: (value: string) =>
    Uint8Array.from(Buffer.from(value, "base64")),
  uint8ArrayToBase64: (value: Uint8Array) =>
    Buffer.from(value).toString("base64"),
  seedXmlFragmentIfEmpty,
}));

import seedPlanCollab from "./seed-plan-collab";

const input = { planId: "plan-1", seedUpdateBase64: "AQID" };
const frontend = { caller: "frontend" } as never;

describe("seed-plan-collab", () => {
  beforeEach(() => {
    assertPlanEditor.mockReset().mockResolvedValue({});
    seedXmlFragmentIfEmpty.mockReset().mockResolvedValue({
      seeded: true,
      state: Uint8Array.from([4, 5, 6]),
    });
  });

  it("seeds the plan's live document once and returns the stored state", async () => {
    const result = await seedPlanCollab.run(input, frontend);

    expect(assertPlanEditor).toHaveBeenCalledWith("plan-1");
    expect(seedXmlFragmentIfEmpty).toHaveBeenCalledWith(
      "plan:plan-1",
      Uint8Array.from([1, 2, 3]),
    );
    expect(result).toEqual({ seeded: true, stateBase64: "BAUG" });
  });

  it("hands back the existing state to the editor that lost the race", async () => {
    seedXmlFragmentIfEmpty.mockResolvedValue({
      seeded: false,
      state: Uint8Array.from([7, 8]),
    });

    await expect(seedPlanCollab.run(input, frontend)).resolves.toEqual({
      seeded: false,
      stateBase64: "Bwg=",
    });
  });

  it("refuses callers that are not the browser editor", async () => {
    await expect(
      seedPlanCollab.run(input, { caller: "agent" } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(seedXmlFragmentIfEmpty).not.toHaveBeenCalled();
  });

  it("refuses anyone who cannot edit the plan", async () => {
    assertPlanEditor.mockRejectedValue(
      Object.assign(new Error("read-only"), { statusCode: 403 }),
    );

    await expect(seedPlanCollab.run(input, frontend)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(seedXmlFragmentIfEmpty).not.toHaveBeenCalled();
  });
});
