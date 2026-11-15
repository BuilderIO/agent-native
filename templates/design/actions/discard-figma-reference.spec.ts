import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  email: vi.fn((): string | undefined => "designer@example.com"),
  discard: vi.fn(async () => true),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.email,
}));
vi.mock("../server/lib/figma-reference-attachment.js", () => ({
  discardFigmaReference: mocks.discard,
}));

import action from "./discard-figma-reference";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.email.mockReturnValue("designer@example.com");
});

describe("discard-figma-reference", () => {
  it("deletes the caller's own staged attachment", async () => {
    await expect(
      action.run({ ref: "attachment:v1:abc" } as never, {} as never),
    ).resolves.toEqual({ deleted: true });
    expect(mocks.discard).toHaveBeenCalledWith(
      "attachment:v1:abc",
      "designer@example.com",
    );
  });

  it("refuses a signed-out caller", async () => {
    mocks.email.mockReturnValue(undefined);
    await expect(
      action.run({ ref: "attachment:v1:abc" } as never, {} as never),
    ).rejects.toThrow(/Sign in/);
    expect(mocks.discard).not.toHaveBeenCalled();
  });
});
