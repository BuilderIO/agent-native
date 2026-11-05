// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  deviceOk: true,
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  readClientAppState: appState.read,
  writeClientAppState: appState.write,
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  writeChatFirstAppLayout: () =>
    appState.deviceOk ? { ok: true } : { ok: false, reason: "write-failed" },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import {
  resetWorkspaceAppLayoutStoreForTests,
  updateWorkspaceAppLayout,
} from "../lib/workspace-app-layout";
import { WorkspaceAppLayoutNotice } from "./workspace-app-layout-notice";

const pin = (id: string) =>
  updateWorkspaceAppLayout((layout) => ({
    ...layout,
    pinnedIds: [id, ...layout.pinnedIds],
  }));

describe("WorkspaceAppLayoutNotice", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetWorkspaceAppLayoutStoreForTests();
    appState.deviceOk = true;
    appState.read.mockReset().mockResolvedValue(null);
    appState.write.mockReset().mockResolvedValue(null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<WorkspaceAppLayoutNotice />));
    // Let the first change read workspace state, so later ones write it.
    await act(async () => pin("seed"));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const notice = () =>
    container.querySelector('[role="status"] [data-app-notice-message]');
  const dismiss = () =>
    container.querySelector<HTMLButtonElement>('[role="status"] button')!;

  it.each([
    [false, true, "dispatch.pages.appPinSaveFailed"],
    [false, false, "dispatch.pages.appPinSaveFailed"],
    [true, false, "dispatch.pages.appPinSavedToWorkspaceOnly"],
  ])(
    "says where pins were saved (workspace %s, device %s)",
    async (workspaceOk, deviceOk, message) => {
      appState.deviceOk = deviceOk;
      appState.write.mockImplementation(() =>
        workspaceOk ? Promise.resolve(null) : Promise.reject(new Error("x")),
      );
      await act(async () => pin("mail"));

      expect(notice()?.textContent).toBe(message);
    },
  );

  it("shows nothing once a later save succeeds", async () => {
    appState.write.mockRejectedValueOnce(new Error("offline"));
    await act(async () => pin("mail"));
    expect(notice()).not.toBeNull();

    await act(async () => pin("plan"));
    expect(notice()).toBeNull();
  });

  it("shows again for a new failure after being dismissed", async () => {
    appState.write.mockRejectedValue(new Error("offline"));
    await act(async () => pin("mail"));
    expect(dismiss().textContent).toBe("agentChat.chatFirst.dismiss");
    await act(async () => dismiss().click());
    expect(notice()).toBeNull();

    await act(async () => pin("plan"));
    expect(notice()?.textContent).toBe("dispatch.pages.appPinSaveFailed");
  });
});
