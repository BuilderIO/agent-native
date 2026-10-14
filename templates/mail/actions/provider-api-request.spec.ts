import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSetting: vi.fn(),
}));

// Capture the options so the spec reads the real needsApproval predicate
// without loading the core provider-api runtime.
vi.mock("@agent-native/core/provider-api/actions/provider-api", () => ({
  createProviderApiRequestAction: (_runtime: unknown, options: unknown) =>
    options,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getCredentialContext: vi.fn(() => null),
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));

vi.mock("../server/lib/provider-api.js", () => ({
  MAIL_APP_ID: "mail",
  MAIL_PROVIDER_API_IDS: ["gmail", "google_calendar", "hubspot"],
  executeProviderApiRequest: vi.fn(),
}));

import action from "./provider-api-request";

const OWNER = "owner@example.com";

type GateArgs = { provider: string; method?: string; path: string };

async function gate(args: GateArgs, caller: "tool" | "automation") {
  const needsApproval = action.needsApproval;
  if (typeof needsApproval !== "function") {
    throw new Error("provider-api-request must define a needsApproval gate");
  }
  return needsApproval(args as Parameters<typeof needsApproval>[0], {
    caller,
    userEmail: OWNER,
  });
}

describe("provider-api-request approval gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSetting.mockResolvedValue({});
  });

  it.each([
    ["POST", "/users/me/messages/abc123/modify"],
    ["post", "/users/me/messages/abc123/modify"],
    ["POST", "/gmail/v1/users/me/messages/abc123/modify"],
    ["POST", "/users/me/threads/thread-1/modify"],
    ["POST", "/users/me/messages/batchModify"],
    ["POST", "/users/me/messages/abc123/trash"],
    ["POST", "/users/me/messages/abc123/untrash"],
    ["POST", "/users/me/threads/thread-1/trash"],
    ["POST", "/users/me/messages/abc123/modify?alt=json"],
    [
      "POST",
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/abc123/modify",
    ],
    [
      "POST",
      "https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-1/trash?alt=json",
    ],
    [
      "POST",
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify",
    ],
    ["GET", "/users/me/messages/send"],
    ["HEAD", "/users/me/drafts/send"],
  ])(
    "does not gate %s %s for an automation without send approval",
    async (method, path) => {
      await expect(
        gate({ provider: "gmail", method, path }, "automation"),
      ).resolves.toBe(false);
      expect(mocks.getUserSetting).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["POST", "/users/me/messages/send"],
    ["post", "/users/me/messages/send"],
    ["POST", "/gmail/v1/users/me/messages/send"],
    ["POST", "//users/me/messages/send"],
    ["POST", "///users/me/drafts/send"],
    ["POST", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"],
    [
      "POST",
      "https://www.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart",
    ],
    ["POST", "/users/me/messages/%73end"],
    ["POST", "/users/me/messages/abc123/%6dodify/../send"],
    ["POST", "/users/me/messages/abc123/modify/../../send"],
    ["POST", "https://evil.example/gmail/v1/users/me/messages/abc123/modify"],
    [
      "POST",
      "http://gmail.googleapis.com/gmail/v1/users/me/messages/abc123/modify",
    ],
    [
      "POST",
      "https://gmail.googleapis.com@evil.example/gmail/v1/users/me/messages/abc123/modify",
    ],
    [
      "POST",
      "https://www.googleapis.com/gmail/v1/users/me/messages/abc123/modify",
    ],
    [
      "POST",
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/abc123/modify/../../send",
    ],
    [
      "POST",
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/abc123/%2e%2e/send",
    ],
    ["POST", "https://gmail.googleapis.com/gmail/v1/users/me/messages/abc123"],
    ["POST", "/users/me/messages/x\\..\\..\\..\\send/trash"],
    ["POST", "/users/me/messages/x%5c..%5csend/trash"],
    ["POST", "/users%2fme%2fmessages%2fx%2ftrash"],
    [
      "POST",
      "https://gmail.googleapis.com:8443/gmail/v1/users/me/messages/abc123/modify",
    ],
    [
      "POST",
      "https://user:secret@gmail.googleapis.com/gmail/v1/users/me/messages/abc123/modify",
    ],
    ["POST", "https:gmail.googleapis.com/users/me/messages/abc123/trash"],
    [
      "POST",
      "https:\\\\gmail.googleapis.com\\users\\me\\messages\\abc123\\trash",
    ],
    ["POST", "/users/me/drafts/send"],
    ["POST", "/users/me/drafts"],
    ["PUT", "/users/me/drafts/draft-1"],
    ["DELETE", "/users/me/messages/abc123"],
    ["POST", "/users/me/messages/batchDelete"],
    ["DELETE", "/users/me/threads/thread-1"],
    ["DELETE", "/users/me/drafts/draft-1"],
    ["DELETE", "/users/me/labels/Label_1"],
    ["POST", "/users/me/messages"],
    ["POST", "/users/me/messages/import"],
    ["PUT", "/users/me/settings/vacation"],
    ["PUT", "/users/me/settings/autoForwarding"],
    ["POST", "/users/me/settings/filters"],
    ["POST", "/users/me/settings/delegates"],
    ["PATCH", "/users/me/settings/sendAs/alias@example.com"],
    ["POST", "/users/me/settings/sendAs/alias@example.com/verify"],
    ["POST", "/users/me/settings/sendAs"],
    ["POST", "/users/me/settings/forwardingAddresses"],
    ["DELETE", "/users/me/settings/forwardingAddresses/a@example.com"],
    ["PUT", "/users/me/messages/abc123/modify"],
  ])(
    "gates %s %s for an automation without send approval",
    async (method, path) => {
      await expect(
        gate({ provider: "gmail", method, path }, "automation"),
      ).resolves.toBe(true);
    },
  );

  it("keeps reversible label writes gated for interactive callers", async () => {
    await expect(
      gate(
        {
          provider: "gmail",
          method: "POST",
          path: "/users/me/messages/abc123/modify",
        },
        "tool",
      ),
    ).resolves.toBe(true);
  });

  it("keeps sends gated for interactive callers and lets an opted-in automation send", async () => {
    await expect(
      gate(
        { provider: "gmail", method: "POST", path: "/users/me/messages/send" },
        "tool",
      ),
    ).resolves.toBe(true);

    mocks.getUserSetting.mockResolvedValue({ allowAutomationSends: true });

    await expect(
      gate(
        { provider: "gmail", method: "POST", path: "/users/me/messages/send" },
        "automation",
      ),
    ).resolves.toBe(false);
  });

  describe("with automation sends enabled", () => {
    beforeEach(() => {
      mocks.getUserSetting.mockResolvedValue({ allowAutomationSends: true });
    });

    it.each([
      ["POST", "/users/me/messages/send"],
      ["POST", "/gmail/v1/users/me/messages/send"],
      ["POST", "/users/me/drafts/send"],
      ["POST", "/users/me/drafts"],
      ["PUT", "/users/me/drafts/draft-1"],
      ["POST", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"],
      [
        "POST",
        "https://www.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart",
      ],
    ])("lets an automation %s %s", async (method, path) => {
      await expect(
        gate({ provider: "gmail", method, path }, "automation"),
      ).resolves.toBe(false);
    });

    it.each([
      ["DELETE", "/users/me/messages/abc123"],
      ["POST", "/users/me/messages/batchDelete"],
      ["DELETE", "/users/me/threads/thread-1"],
      ["DELETE", "/users/me/drafts/draft-1"],
      ["PUT", "/users/me/settings/autoForwarding"],
      ["PUT", "/users/me/settings/vacation"],
      ["POST", "/users/me/settings/filters"],
      ["POST", "/users/me/settings/delegates"],
      ["POST", "/users/me/settings/forwardingAddresses"],
      ["PATCH", "/users/me/settings/sendAs/alias@example.com"],
      ["POST", "/users/me/messages"],
      ["POST", "/users/me/messages/import"],
      ["POST", "/users/me/labels"],
      ["PUT", "/users/me/messages/send"],
      ["POST", "/users/me/messages/abc123/send"],
      [
        "POST",
        "https://www.googleapis.com/upload/gmail/v1/users/me/messages/import",
      ],
      ["POST", "https://evil.example/gmail/v1/users/me/messages/send"],
    ])("still gates %s %s for an automation", async (method, path) => {
      await expect(
        gate({ provider: "gmail", method, path }, "automation"),
      ).resolves.toBe(true);
    });

    it("does not extend the opt-in to an interactive caller", async () => {
      await expect(
        gate(
          {
            provider: "gmail",
            method: "POST",
            path: "/users/me/messages/send",
          },
          "tool",
        ),
      ).resolves.toBe(true);
    });
  });

  it("keeps a per-tool always-allow from standing in for the per-request gate", () => {
    expect(
      (action as { allowPersistentApproval?: boolean }).allowPersistentApproval,
    ).toBe(false);
  });

  it("gates an unknown write path by default", async () => {
    await expect(
      gate(
        {
          provider: "gmail",
          method: "POST",
          path: "/users/me/messages/sendAll",
        },
        "automation",
      ),
    ).resolves.toBe(true);
  });

  it("does not decode a malformed path for a non-Gmail provider", async () => {
    await expect(
      gate(
        {
          provider: "hubspot",
          method: "POST",
          path: "/crm/v3/objects/%E0%A4%A",
        },
        "automation",
      ),
    ).resolves.toBe(false);
  });

  it("leaves other providers ungated", async () => {
    await expect(
      gate(
        {
          provider: "google_calendar",
          method: "POST",
          path: "/calendars/primary/events",
        },
        "automation",
      ),
    ).resolves.toBe(false);
    await expect(
      gate(
        {
          provider: "hubspot",
          method: "POST",
          path: "/crm/v3/objects/contacts",
        },
        "automation",
      ),
    ).resolves.toBe(false);
  });

  it("throws on a malformed path encoding so callers fail closed", async () => {
    await expect(
      gate(
        {
          provider: "gmail",
          method: "POST",
          path: "/users/me/messages/%E0%A4%A",
        },
        "automation",
      ),
    ).rejects.toThrow(URIError);
  });

  it("throws on an unparseable absolute URL so callers fail closed", async () => {
    await expect(
      gate(
        { provider: "gmail", method: "POST", path: "https://" },
        "automation",
      ),
    ).rejects.toThrow(TypeError);
  });
});
