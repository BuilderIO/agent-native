import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBigQueryAccessToken: vi.fn(),
  getCredentialContextFromEvent: vi.fn(),
  readBody: vi.fn(),
  resolveCredential: vi.fn(),
  resolveBigQueryOAuthCredential: vi.fn(),
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
vi.mock("../lib/provider-credentials", () => ({
  resolveBigQueryOAuthCredential: mocks.resolveBigQueryOAuthCredential,
}));
vi.mock("../lib/bigquery", () => ({
  getAppEventsTable: async () => ({
    projectId: "example-project",
    datasetId: "analytics",
    tableId: "events_partitioned",
  }),
}));
vi.mock("../lib/gcloud", () => ({
  getBigQueryAccessToken: mocks.getBigQueryAccessToken,
}));

import { resetAppConfigForTests } from "@agent-native/core/app-config";

import { handleTrackEvent } from "./events";

describe("handleTrackEvent", () => {
  beforeEach(() => {
    mocks.getCredentialContextFromEvent.mockReset();
    mocks.getCredentialContextFromEvent.mockResolvedValue({
      userEmail: "real@example.com",
      orgId: null,
    });
    mocks.getBigQueryAccessToken.mockReset();
    mocks.getBigQueryAccessToken.mockResolvedValue("token");
    mocks.resolveCredential.mockReset();
    mocks.resolveCredential.mockResolvedValue(undefined);
    mocks.resolveBigQueryOAuthCredential.mockReset();
    mocks.resolveBigQueryOAuthCredential.mockResolvedValue(null);
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
    expect(mocks.resolveBigQueryOAuthCredential).toHaveBeenCalledTimes(2);
  });

  it("reuses the resolved BigQuery OAuth grant for event inserts", async () => {
    const oauthCredential = {
      value: "user-google-token",
      key: "BIGQUERY_OAUTH_TOKEN",
      provider: "bigquery",
      source: "workspace_connection",
    };
    mocks.resolveCredential.mockImplementation(async (key: string) =>
      key === "BIGQUERY_PROJECT_ID" ? "test-project" : undefined,
    );
    mocks.resolveBigQueryOAuthCredential.mockResolvedValueOnce(oauthCredential);
    mocks.readBody.mockResolvedValueOnce({
      event: "page_view",
      userId: "real@example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );

    try {
      await handleTrackEvent({} as any);

      expect(mocks.getBigQueryAccessToken).toHaveBeenCalledWith({
        projectId: "test-project",
        oauthCredential,
      });
      expect(mocks.resolveBigQueryOAuthCredential).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses configured service-account auth without resolving a personal OAuth grant", async () => {
    mocks.resolveCredential.mockImplementation(async (key: string) =>
      key === "BIGQUERY_PROJECT_ID"
        ? "test-project"
        : key === "GOOGLE_APPLICATION_CREDENTIALS_JSON"
          ? "service-account-json"
          : undefined,
    );
    mocks.getBigQueryAccessToken.mockResolvedValueOnce("service-account-token");
    mocks.readBody.mockResolvedValueOnce({
      event: "page_view",
      userId: "real@example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );

    try {
      await expect(handleTrackEvent({} as any)).resolves.toEqual({
        success: true,
      });
      expect(mocks.getBigQueryAccessToken).toHaveBeenCalledWith({
        projectId: "test-project",
        oauthCredential: null,
      });
      expect(mocks.resolveBigQueryOAuthCredential).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips BigQuery OAuth lookup when service-account credentials are configured", async () => {
    mocks.resolveCredential.mockImplementation(async (key: string) =>
      key === "BIGQUERY_PROJECT_ID"
        ? "test-project"
        : key === "GOOGLE_APPLICATION_CREDENTIALS_JSON"
          ? "service-account-json"
          : undefined,
    );
    mocks.resolveBigQueryOAuthCredential.mockRejectedValueOnce(
      new Error("OAuth refresh service unavailable"),
    );
    mocks.getBigQueryAccessToken.mockResolvedValueOnce("service-account-token");
    mocks.readBody.mockResolvedValueOnce({
      event: "page_view",
      userId: "real@example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );

    try {
      await expect(handleTrackEvent({} as any)).resolves.toEqual({
        success: true,
      });
      expect(mocks.getBigQueryAccessToken).toHaveBeenCalledWith({
        projectId: "test-project",
        oauthCredential: null,
      });
      expect(mocks.resolveBigQueryOAuthCredential).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves BigQuery OAuth lookup failures when service-account auth is absent", async () => {
    mocks.resolveCredential.mockImplementation(async (key: string) =>
      key === "BIGQUERY_PROJECT_ID" ? "test-project" : undefined,
    );
    mocks.resolveBigQueryOAuthCredential.mockRejectedValueOnce(
      new Error("OAuth refresh service unavailable"),
    );
    mocks.readBody.mockResolvedValueOnce({
      event: "page_view",
      userId: "real@example.com",
    });

    await expect(handleTrackEvent({} as any)).resolves.toEqual({
      error: "OAuth refresh service unavailable",
    });
    expect(mocks.getBigQueryAccessToken).not.toHaveBeenCalled();
  });

  describe("a retained exception", () => {
    async function storedRow(body: Record<string, unknown>) {
      const fetchMock = vi.fn(async () => new Response("{}"));
      vi.stubGlobal("fetch", fetchMock);
      mocks.resolveCredential.mockResolvedValue("configured");
      mocks.readBody.mockResolvedValueOnce(body);
      try {
        await handleTrackEvent({} as any);
        const [, init] = fetchMock.mock.calls[0] as unknown as [
          string,
          { body: string },
        ];
        const row = JSON.parse(init.body).rows[0].json;
        return { ...row, data: JSON.parse(row.data) };
      } finally {
        vi.unstubAllGlobals();
      }
    }

    it("carries the session's test identity when the client sends an opaque uid", async () => {
      vi.stubEnv("AGENT_NATIVE_TEST_IDENTITY_EMAILS", "qa@corp.example");
      resetAppConfigForTests();
      try {
        mocks.getCredentialContextFromEvent.mockResolvedValue({
          userEmail: "qa@corp.example",
          orgId: null,
        });
        const row = await storedRow({
          event: "$exception",
          userId: "firebase-uid-123",
          data: { message: "boom" },
        });
        expect(row.userEmail).toBe("qa@corp.example");
        expect(row.data).toMatchObject({
          message: "boom",
          test_identity: true,
        });
      } finally {
        vi.unstubAllEnvs();
        resetAppConfigForTests();
      }
    });

    it("drops a client-set marker from a real user's exception", async () => {
      const row = await storedRow({
        event: "$exception",
        userId: "firebase-uid-456",
        data: { message: "boom", test_identity: true },
      });
      expect(row.userEmail).toBeNull();
      expect(row.data).toEqual({ message: "boom" });
    });
  });
});
