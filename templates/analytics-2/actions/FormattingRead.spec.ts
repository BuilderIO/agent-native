import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ read: vi.fn(), current: vi.fn() }));
vi.mock("@agent-native/core/settings", () => ({ getOrgSetting: m.read }));
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: m.current,
}));
import action from "./get-sql-formatting-preferences";
beforeEach(() => {
  vi.resetAllMocks();
  m.current.mockResolvedValue({
    orgId: "org-synthetic",
    access: { orgRole: "admin" },
  });
});
it("distinguishes absent preferences from saved preferences", async () => {
  m.read.mockResolvedValueOnce(null).mockResolvedValueOnce({
    keywordCase: "lower",
    newlineBeforeClauses: false,
  });
  expect((await action.run({}, {} as never)).state).toBe("default");
  expect(await action.run({}, {} as never)).toEqual({
    state: "stored",
    options: { keywordCase: "lower", newlineBeforeClauses: false },
  });
});
it("does not turn unreadable storage into defaults", async () => {
  const failure = new Error("storage-unreadable");
  m.read.mockRejectedValue(failure);
  await expect(action.run({}, {} as never)).rejects.toBe(failure);
});
it("rejects malformed stored preferences", async () => {
  m.read.mockResolvedValue({ keywordCase: "invalid" });
  await expect(action.run({}, {} as never)).rejects.toThrow(
    "could not be read",
  );
});
it("rejects a member before reading workspace preferences", async () => {
  m.current.mockResolvedValue({
    orgId: "org-synthetic",
    access: { orgRole: "member" },
  });
  await expect(action.run({}, {} as never)).rejects.toThrow("administrator");
  expect(m.read).not.toHaveBeenCalled();
});
