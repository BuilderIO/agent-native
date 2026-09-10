import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync("app/components/email/EmailThread.tsx", "utf8");

describe("EmailThread read state action", () => {
  it("shows the current read-state toggle in the thread toolbar", () => {
    expect(source).toContain("setCurrentEmailReadState(!email.isRead)");
    expect(source).toContain("keepUnreadThreadRef.current !== threadId");
    expect(source).toContain("keepUnreadThreadRef.current = undefined");
    expect(source).toContain("clearTimeout(autoReadTimerRef.current)");
    expect(source).toContain("failedAutoReadThreadRef.current = id");
    expect(source).toContain('? "mail.actions.markUnread"');
    expect(source).toContain(': "mail.actions.markRead"');
    expect(source).toContain('<IconMail className="h-4 w-4" />');
    expect(source).toContain('<IconMailOpened className="h-4 w-4" />');
  });
});
