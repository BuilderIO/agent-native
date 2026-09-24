import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";
import { isOAuthConnected } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/oauth-tokens", () => ({
  deleteOAuthTokens: vi.fn(),
  getOAuthTokens: vi.fn(),
  hasOAuthTokens: vi.fn(),
  listOAuthAccounts: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  saveOAuthTokens: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  GOOGLE_PRIMARY_PROVIDER_CREDENTIAL_KEYS: {
    clientIdKey: "GOOGLE_CLIENT_ID",
    clientSecretKey: "GOOGLE_CLIENT_SECRET",
  },
  getOAuthAccounts: vi.fn(),
  isOAuthConnected: vi.fn(async () => true),
  resolveGoogleProviderCredentialCandidatesWithReader: vi.fn(async () => [
    { clientId: "test-client-id", clientSecret: "test-client-secret" },
  ]),
  resolveSecret: vi.fn(async () => "test-secret"),
  runWithRequestContext: vi.fn(async (_c: any, fn: any) => fn()),
}));

vi.mock("./google-api.js", () => ({
  createOAuth2Client: vi.fn(),
  gmailBatchGetMessages: vi.fn(),
  gmailBatchGetThreads: vi.fn(async (_t: string, ids: string[]) =>
    ids.map((id) => ({
      id,
      data: {
        messages: [
          {
            id: `${id}-m1`,
            threadId: id,
            labelIds: ["SENT"],
            internalDate: "1000",
            payload: {
              headers: [{ name: "Date", value: new Date().toUTCString() }],
            },
          },
        ],
      },
    })),
  ),
  gmailGetMessage: vi.fn(),
  gmailGetProfile: vi.fn(),
  gmailGetThread: vi.fn(),
  gmailListHistory: vi.fn(),
  gmailListLabels: vi.fn(async () => ({ labels: [] })),
  gmailListMessages: vi.fn(async () => ({ messages: [] })),
  gmailListThreads: vi.fn(async (_t: string, _params: any) => {
    return { threads: [{ id: "thread-sent-1" }], resultSizeEstimate: 1 };
  }),
  gmailStopWatch: vi.fn(),
  gmailWatch: vi.fn(),
  googleFetch: vi.fn(),
  peopleGetProfile: vi.fn(),
}));

import { isConnected } from "./google-auth.js";
import { listInboxEmails } from "./list-inbox-emails.js";

describe("probe: fresh connect + sent fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
      {
        accountId: "sharon@example.com",
        owner: "sharon@example.com",
        tokens: {
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          expiry_date: Date.now() + 60 * 60 * 1000,
        },
      },
    ] as any);
  });

  it("isConnected is true right after connect", async () => {
    const connected = await isConnected("sharon@example.com");
    expect(connected).toBe(true);
  });

  it("listInboxEmails view=sent returns sent messages", async () => {
    const result = await listInboxEmails({
      ownerEmail: "sharon@example.com",
      view: "sent",
      limit: 25,
      accountTokens: [
        { email: "sharon@example.com", accessToken: "test-access-token" },
      ],
      labelMap: new Map(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.emails.length).toBeGreaterThan(0);
    }
  });
});
