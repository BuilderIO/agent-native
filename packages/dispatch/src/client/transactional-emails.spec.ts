import { describe, expect, it } from "vitest";

import {
  aggregateSharedEmails,
  type AppEmailCatalog,
  type AppTransactionalEmail,
  type LocalTransactionalEmailCatalog,
} from "./transactional-emails";

const coreEmail: AppTransactionalEmail = {
  id: "core.reset-password",
  app: "core",
  name: "Reset password",
  trigger: "A password reset is requested.",
  recipient: "The account address.",
  recipientLabel: "Account address",
  sender: "The configured sender.",
  senderLabel: "Configured sender",
  sent: 2,
  failed: 1,
  lastSentAt: 100,
};

const local: LocalTransactionalEmailCatalog = {
  app: "dispatch",
  statsAvailable: true,
  statsError: null,
  emails: [coreEmail],
};

function appCatalog(
  appId: string,
  email: AppTransactionalEmail,
): AppEmailCatalog {
  return {
    appId,
    appName: appId,
    appPath: `/${appId}`,
    emails: [email],
    error: null,
    statsError: null,
  };
}

describe("aggregateSharedEmails", () => {
  it("sums shared email counts across sending apps", () => {
    const result = aggregateSharedEmails(local, [
      appCatalog("calendar", {
        ...coreEmail,
        sent: 3,
        failed: 0,
        lastSentAt: 200,
      }),
      appCatalog("forms", {
        ...coreEmail,
        sent: 1,
        failed: 2,
        lastSentAt: 150,
      }),
    ]);

    expect(result).toEqual({
      statsError: null,
      emails: [
        {
          ...coreEmail,
          sent: 6,
          failed: 3,
          lastSentAt: 200,
        },
      ],
    });
  });

  it("does not present partial totals when an app log is unreadable", () => {
    const unreadable = appCatalog("calendar", coreEmail);
    unreadable.statsError = "database unavailable";

    expect(aggregateSharedEmails(local, [unreadable])).toEqual({
      statsError: "database unavailable",
      emails: [
        {
          ...coreEmail,
          sent: null,
          failed: null,
          lastSentAt: null,
        },
      ],
    });
  });
});
