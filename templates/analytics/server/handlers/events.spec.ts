import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCredentialContextFromEvent: vi.fn(),
  readBody: vi.fn(),
  resolveCredential: vi.fn(),
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
  getCredentialContextFromEvent: mocks.getCredentialContextFromEvent,
  resolveCredential: mocks.resolveCredential,
}));
vi.mock("../lib/bigquery", () => ({ getAppEventsTable: vi.fn() }));
vi.mock("../lib/gcloud", () => ({ getAccessToken: vi.fn() }));

import { resetAppConfigForTests } from "@agent-native/core/app-config";

import { handleTrackEvent } from "./events";

describe("handleTrackEvent", () => {
  beforeEach(() => {
    mocks.getCredentialContextFromEvent.mockReset();
    mocks.getCredentialContextFromEvent.mockResolvedValue({
      userEmail: "real@example.com",
      orgId: null,
    });
    mocks.resolveCredential.mockReset();
    mocks.resolveCredential.mockResolvedValue(undefined);
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
    expect(mocks.resolveCredential).not.toHaveBeenCalled();
  });

  it("checks the signed-in email when the client sends only an opaque uid", async () => {
    vi.stubEnv("AGENT_NATIVE_TEST_IDENTITY_EMAILS", "qa@corp.example");
    resetAppConfigForTests();
    try {
      mocks.getCredentialContextFromEvent.mockResolvedValue({
        userEmail: "qa@corp.example",
        orgId: null,
      });
      mocks.readBody.mockResolvedValueOnce({
        event: "page_view",
        userId: "firebase-uid-123",
      });

      await expect(handleTrackEvent({} as any)).resolves.toEqual({
        success: true,
        accepted: 0,
        suppressedTestIdentity: 1,
      });
      expect(mocks.resolveCredential).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      resetAppConfigForTests();
    }
  });

  it("does not treat a missing session as a test identity", async () => {
    mocks.getCredentialContextFromEvent.mockResolvedValue(null);
    mocks.readBody.mockResolvedValueOnce({
      event: "page_view",
      userId: "firebase-uid-123",
    });

    await expect(handleTrackEvent({} as any)).resolves.toEqual({
      success: true,
    });
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

    expect(mocks.resolveCredential).toHaveBeenCalledTimes(4);
  });
});
