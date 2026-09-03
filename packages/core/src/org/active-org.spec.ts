import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserSetting =
  vi.fn<(email: string, key: string) => Promise<unknown>>();
const putUserSetting = vi.fn(async () => {});

vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: (email: string, key: string) => getUserSetting(email, key),
  putUserSetting: (...args: unknown[]) =>
    (putUserSetting as unknown as (...a: unknown[]) => Promise<void>)(...args),
}));

const { drainAgentWarnings } = await import("../agent/action-warnings.js");
const { runWithRequestContext } = await import("../server/request-context.js");
const { setActiveOrgId } = await import("./active-org.js");

let warn: ReturnType<typeof vi.spyOn>;

function warnings(): string {
  return warn.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("setActiveOrgId", () => {
  beforeEach(() => {
    getUserSetting.mockReset();
    putUserSetting.mockClear();
    getUserSetting.mockResolvedValue({ orgId: null });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();
  });

  it("writes the setting in the shape the readers expect", async () => {
    await setActiveOrgId("owner@example.com", "org-1", "test");

    expect(putUserSetting).toHaveBeenCalledWith(
      "owner@example.com",
      "active-org-id",
      { orgId: "org-1" },
    );
  });

  it("names the orphaned-credential consequence when repointing across orgs", async () => {
    getUserSetting.mockResolvedValue({ orgId: "builder-io" });

    await setActiveOrgId(
      "tim@example.com",
      "coach-org",
      "roster migration action",
    );

    const message = warnings();
    expect(message).toContain("builder-io");
    expect(message).toContain("coach-org");
    expect(message).toContain("roster migration action");
    expect(message).toMatch(/NOT shared between them/);
    expect(putUserSetting).toHaveBeenCalled();
  });

  it("stays quiet for a first-time assignment", async () => {
    getUserSetting.mockResolvedValue(null);

    await setActiveOrgId(
      "new@example.com",
      "org-1",
      "auto-created default org",
    );

    expect(warn).not.toHaveBeenCalled();
    expect(putUserSetting).toHaveBeenCalled();
  });

  it("stays quiet when re-writing the same org", async () => {
    getUserSetting.mockResolvedValue({ orgId: "org-1" });

    await setActiveOrgId("owner@example.com", "org-1", "no-op");

    expect(warn).not.toHaveBeenCalled();
  });

  it("stays quiet when clearing the active org", async () => {
    getUserSetting.mockResolvedValue({ orgId: "org-1" });

    await setActiveOrgId("owner@example.com", null, "cleared");

    expect(warn).not.toHaveBeenCalled();
    expect(putUserSetting).toHaveBeenCalledWith(
      "owner@example.com",
      "active-org-id",
      { orgId: null },
    );
  });

  // An unreadable previous org must not read as "had none" — that is exactly
  // how a silent repoint would look like a harmless first-time assignment.
  it("distinguishes an unreadable previous org from an absent one", async () => {
    getUserSetting.mockRejectedValue(new Error("no such table: settings"));

    await setActiveOrgId("owner@example.com", "org-2", "switch");

    expect(warnings()).toContain(
      "Could not read the previous active organization",
    );
    expect(putUserSetting).toHaveBeenCalled();
  });

  // Inside an agent run the repoint has to reach the conversation, not a server
  // log the user will never open.
  it("routes the repoint warning to the agent channel during a run", async () => {
    getUserSetting.mockResolvedValue({ orgId: "builder-io" });

    await runWithRequestContext({ run: {} }, async () => {
      await setActiveOrgId("tim@example.com", "coach-org", "roster migration");

      const warnings = drainAgentWarnings();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.severity).toBe("critical");
      expect(warnings[0]!.code).toBe("org-cross-org-repoint");
      expect(warnings[0]!.message).toContain("NOT shared between them");
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the account email out of the log", async () => {
    getUserSetting.mockResolvedValue({ orgId: "builder-io" });

    await setActiveOrgId("tim@example.com", "coach-org", "switch");

    expect(warnings()).not.toContain("tim@example.com");
  });
});
