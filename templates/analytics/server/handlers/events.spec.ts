import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readBody: vi.fn(),
  withRequestContextFromEvent: vi.fn(async () => null),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  readBody: mocks.readBody,
}));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  getHeader: () => undefined,
  setResponseStatus: vi.fn(),
}));
vi.mock("../lib/credentials", () => ({
  resolveCredential: vi.fn(),
  withRequestContextFromEvent: mocks.withRequestContextFromEvent,
}));
vi.mock("../lib/bigquery", () => ({ getAppEventsTable: vi.fn() }));
vi.mock("../lib/gcloud", () => ({ getAccessToken: vi.fn() }));

import { handleTrackEvent } from "./events";

describe("handleTrackEvent", () => {
  beforeEach(() => {
    mocks.withRequestContextFromEvent.mockClear();
  });

  it("does not ship a test identity's events to the warehouse", async () => {
    mocks.readBody.mockResolvedValueOnce({
      event: "page_view",
      data: { user_email: "qa+autoz@builder.io" },
    });

    await expect(handleTrackEvent({} as any)).resolves.toEqual({
      success: true,
      accepted: 0,
      suppressedTestIdentity: 1,
    });
    expect(mocks.withRequestContextFromEvent).not.toHaveBeenCalled();
  });

  it("still ships real users' events and test identities' exceptions", async () => {
    mocks.readBody
      .mockResolvedValueOnce({ event: "page_view", userId: "real@example.com" })
      .mockResolvedValueOnce({
        event: "$exception",
        userId: "qa+autoz@builder.io",
      });

    await handleTrackEvent({} as any);
    await handleTrackEvent({} as any);

    expect(mocks.withRequestContextFromEvent).toHaveBeenCalledTimes(2);
  });
});
