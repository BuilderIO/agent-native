import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getOverlayReciprocityMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: getRequestUserEmailMock,
}));
vi.mock("../server/lib/booking-host-availability.js", () => ({
  getOverlayReciprocity: getOverlayReciprocityMock,
}));

import action from "./get-overlay-reciprocity";

const OWNER = "owner@example.com";
const PEER = "peer@example.com";

function run(args: Record<string, unknown>) {
  return action.run(args as never, undefined as never) as Promise<
    Array<Record<string, unknown>>
  >;
}

describe("get-overlay-reciprocity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue(OWNER);
    getOverlayReciprocityMock.mockResolvedValue([]);
  });

  it("throws when there is no authenticated caller", async () => {
    getRequestUserEmailMock.mockReturnValue(undefined);

    await expect(run({ emails: [PEER] })).rejects.toThrow(
      "no authenticated user",
    );
  });

  it("always resolves against the caller's own overlay list", async () => {
    await run({ emails: [PEER] });

    expect(getOverlayReciprocityMock).toHaveBeenCalledWith(OWNER, [PEER]);
  });

  it("normalizes and dedupes requested emails", async () => {
    await run({ emails: [" Peer@Example.com ", PEER, "not an email"] });

    expect(getOverlayReciprocityMock).toHaveBeenCalledWith(OWNER, [PEER]);
  });

  it("returns reciprocity rows without any working-hours claim", async () => {
    getOverlayReciprocityMock.mockResolvedValue([
      { email: PEER, reciprocal: true, displayName: "Peer" },
    ]);

    const result = await run({ emails: [PEER] });

    expect(result).toEqual([
      { email: PEER, reciprocal: true, displayName: "Peer" },
    ]);
    expect(result[0]).not.toHaveProperty("hasWorkingHours");
  });

  it("rejects an emails array over the cap", async () => {
    const many = Array.from(
      { length: 51 },
      (_value, index) => `peer${index}@example.com`,
    );

    await expect(run({ emails: many })).rejects.toBeTruthy();
  });
});
