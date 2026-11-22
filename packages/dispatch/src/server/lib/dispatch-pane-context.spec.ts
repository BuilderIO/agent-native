import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  tab: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.read,
  resolveCurrentRequestStateTab: mocks.tab,
  appStateKeyForBrowserTab: (key: string, tabId: string) => `${key}:${tabId}`,
}));

import { resolveDispatchChildBrowserTab } from "./dispatch-pane-context.js";

it("looks up the current Dispatch tab and forwards only a fresh matching installation binding", async () => {
  const mail = { id: "workspace/mail", url: "https://example.test/mail" };
  const row = {
    appId: mail.id,
    origin: "https://example.test",
    childBrowserTabId: "d178e672-918b-4c93-bd78-f627f7f00001",
    observedAt: Date.now(),
  };
  mocks.tab.mockResolvedValue({ tabId: "parent-one", unavailable: false });
  mocks.read.mockResolvedValue(row);
  expect(await resolveDispatchChildBrowserTab(mail)).toBe(
    row.childBrowserTabId,
  );
  expect(mocks.read).toHaveBeenLastCalledWith(
    "dispatch-pane-context:parent-one",
  );

  mocks.tab.mockResolvedValue({ tabId: "parent-two", unavailable: false });
  mocks.read.mockResolvedValue(null);
  expect(await resolveDispatchChildBrowserTab(mail)).toBeUndefined();
  expect(mocks.read).toHaveBeenLastCalledWith(
    "dispatch-pane-context:parent-two",
  );

  mocks.read.mockResolvedValue({
    ...row,
    origin: "https://other.example.test",
  });
  expect(await resolveDispatchChildBrowserTab(mail)).toBeUndefined();
  mocks.read.mockResolvedValue({ ...row, observedAt: 0 });
  await expect(resolveDispatchChildBrowserTab(mail)).rejects.toMatchObject({
    errorCode: "dispatch_pane_tab_unavailable",
  });

  mocks.read.mockClear();
  mocks.tab.mockResolvedValue({ tabId: null, unavailable: false });
  expect(await resolveDispatchChildBrowserTab(mail)).toBeUndefined();
  expect(mocks.read).not.toHaveBeenCalled();
});
