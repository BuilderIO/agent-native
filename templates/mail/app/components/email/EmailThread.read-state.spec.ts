import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync("app/components/email/EmailThread.tsx", "utf8");

describe("EmailThread read state action", () => {
  it("shows the current read-state toggle in the thread toolbar", () => {
    expect(source).toContain("isRead: !email.isRead");
    expect(source).toContain(
      "accountEmail: email.accountEmail,\n            threadId,",
    );
    expect(source).toContain('? "mail.actions.markUnread"');
    expect(source).toContain(': "mail.actions.markRead"');
    expect(source).toContain('<IconMail className="h-4 w-4" />');
    expect(source).toContain('<IconMailOpened className="h-4 w-4" />');
  });
});
