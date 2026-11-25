import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertGmailNotCoolingDown: vi.fn(),
  getClientsWithErrors: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getUserSetting: vi.fn(),
  gmailToEmailMessage: vi.fn(),
  isConnected: vi.fn(),
  listGmailMessages: vi.fn(),
}));

vi.mock("../server/lib/gmail-quota.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/gmail-quota.js")>()),
  assertGmailNotCoolingDown: mocks.assertGmailNotCoolingDown,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));

vi.mock("../server/lib/google-auth.js", () => ({
  getClientsWithErrors: mocks.getClientsWithErrors,
  gmailToEmailMessage: mocks.gmailToEmailMessage,
  isConnected: mocks.isConnected,
  listGmailMessages: mocks.listGmailMessages,
}));

import { GmailQuotaCooldownError } from "../server/lib/google-api.js";
import action from "./list-contact-attachments";

const OWNER = "owner@example.com";
const ACCOUNT = "inbox@example.com";
const PRIYA = "priya@northwind.example";

function email(
  id: string,
  date: string,
  from: string,
  filenames: string[],
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    threadId: `thread-${id}`,
    from: { name: "", email: from },
    to: [{ name: "", email: OWNER }],
    subject: `Subject ${id}`,
    snippet: "",
    body: "",
    date,
    isRead: true,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    labelIds: [],
    attachments: filenames.map((filename, index) => ({
      id: `${id}-att-${index}`,
      filename,
      mimeType: "application/pdf",
      size: 1000 + index,
    })),
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertGmailNotCoolingDown.mockResolvedValue(undefined);
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.isConnected.mockResolvedValue(true);
  mocks.getClientsWithErrors.mockResolvedValue({
    clients: [
      { email: ACCOUNT, accessToken: "access-token", refreshToken: "" },
    ],
    errors: [],
  });
  mocks.gmailToEmailMessage.mockImplementation((message) => message);
});

describe("list-contact-attachments", () => {
  it("searches Gmail for the person's files and lists them newest first", async () => {
    mocks.listGmailMessages.mockResolvedValue({
      messages: [
        email("older", "2026-11-24T10:00:00Z", PRIYA, ["questionnaire.xlsx"]),
        email("newer", "2026-11-25T10:00:00Z", PRIYA, [
          "pilot-plan.pdf",
          "sso.docx",
        ]),
      ],
      errors: [],
    });

    const result = await action.run({ email: PRIYA });

    expect(mocks.listGmailMessages).toHaveBeenCalledWith(
      `from:${PRIYA} has:attachment`,
      10,
      OWNER,
    );
    expect(result.attachments.map((file) => file.filename)).toEqual([
      "pilot-plan.pdf",
      "sso.docx",
      "questionnaire.xlsx",
    ]);
    expect(result.attachments[0]).toEqual(
      expect.objectContaining({
        emailId: "newer",
        threadId: "thread-newer",
        subject: "Subject newer",
      }),
    );
  });

  it("stops at the limit even when one email carries several files", async () => {
    mocks.listGmailMessages.mockResolvedValue({
      messages: [
        email("one", "2026-11-25T10:00:00Z", PRIYA, [
          "a.pdf",
          "b.pdf",
          "c.pdf",
        ]),
      ],
      errors: [],
    });

    const result = await action.run({ email: PRIYA, limit: 2 });

    expect(result.attachments.map((file) => file.filename)).toEqual([
      "a.pdf",
      "b.pdf",
    ]);
  });

  it("fails loudly instead of reporting no files when Gmail errors", async () => {
    mocks.listGmailMessages.mockResolvedValue({
      messages: [],
      errors: [{ email: ACCOUNT, error: "Token expired" }],
    });

    await expect(action.run({ email: PRIYA })).rejects.toThrow(
      `${ACCOUNT}: Token expired`,
    );
  });

  it("reports a Gmail cooldown as a cooldown", async () => {
    mocks.listGmailMessages.mockResolvedValue({
      messages: [],
      errors: [
        {
          email: ACCOUNT,
          error: "busy",
          isQuotaError: true,
          retryAfterMs: 30_000,
        },
      ],
    });

    await expect(action.run({ email: PRIYA })).rejects.toBeInstanceOf(
      GmailQuotaCooldownError,
    );
  });

  it("reads local mail when no Google account is connected", async () => {
    mocks.isConnected.mockResolvedValue(false);
    mocks.getUserSetting.mockResolvedValue({
      emails: [
        email("mine", "2026-11-25T10:00:00Z", PRIYA, ["plan.pdf"]),
        email("other", "2026-11-25T11:00:00Z", "sam@example.org", ["x.pdf"]),
        email("trashed", "2026-11-25T12:00:00Z", PRIYA, ["old.pdf"], {
          isTrashed: true,
        }),
      ],
    });

    const result = await action.run({ email: PRIYA });

    expect(mocks.listGmailMessages).not.toHaveBeenCalled();
    expect(result.attachments.map((file) => file.filename)).toEqual([
      "plan.pdf",
    ]);
  });
});
