import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionRunContext } from "../action.js";
import type { DbExecQuery } from "../db/client.js";
import type { sendEmail } from "../server/email.js";
import { inviteOrganizationAdmin } from "./index.js";

const seam = vi.hoisted(() => ({
  send: vi.fn<typeof sendEmail>(),
  configured: true,
}));
vi.mock("../db/client.js", async (original) => ({
  ...(await original<typeof import("../db/client.js")>()),
  getDbExec: () => ({
    execute: async ({ sql, args }: DbExecQuery & { args: unknown[] }) => {
      if (/SELECT role FROM org_members/.test(sql))
        return { rows: [{ role: "owner" }] };
      if (/SELECT name FROM organizations/.test(sql))
        return { rows: [{ name: "Actor workspace" }] };
      if (/SELECT 1 FROM org_/.test(sql)) return { rows: [] };
      if (/INSERT INTO org_invitations|DELETE FROM org_invitations/.test(sql))
        return { rows: [] };
      throw new Error(`Unexpected DB operation: ${sql} ${String(args)}`);
    },
  }),
}));
vi.mock("../server/email.js", () => ({
  isEmailConfigured: async () => seam.configured,
  sendEmail: (...args: Parameters<typeof sendEmail>) => seam.send(...args),
}));
vi.mock("../audit/record.js", () => ({
  recordActionAudit: async () => undefined,
}));

const actor: ActionRunContext = {
  caller: "frontend",
  userEmail: "owner@example.test",
  orgId: "org-a",
  threadId: "thread-a",
};
const invite = () =>
  inviteOrganizationAdmin({ email: "new@example.test" }, actor);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  seam.configured = true;
  seam.send.mockResolvedValue({ status: "sent", provider: "dev" });
});

describe("invitation email delivery reporting", () => {
  it("reports emailSent only when the transport sent the message", async () => {
    const result = await invite();
    expect(result.emailSent).toBe(true);
    expect(result.emailError).toBeUndefined();
  });

  it("does not report a suppressed send as delivered", async () => {
    seam.send.mockResolvedValue({
      status: "suppressed",
      reason: "test-identity",
    });
    const result = await invite();
    expect(result.emailSent).toBe(false);
    expect(result.emailError).toBe("The invitation email was not delivered");
  });

  it("names the missing email configuration instead of staying silent", async () => {
    seam.configured = false;
    const result = await invite();
    expect(result.emailSent).toBe(false);
    expect(result.emailError).toBe("Email delivery is not configured");
    expect(seam.send).not.toHaveBeenCalled();
  });

  it("surfaces a transport failure message", async () => {
    seam.send.mockRejectedValue(new Error("synthetic SMTP failure"));
    const result = await invite();
    expect(result.emailSent).toBe(false);
    expect(result.emailError).toBe("synthetic SMTP failure");
  });
});
