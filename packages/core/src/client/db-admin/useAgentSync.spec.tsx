// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chatMocks = vi.hoisted(() => ({
  removeAgentChatContextItem: vi.fn(),
  setAgentChatContextItem: vi.fn(),
}));

const appStateMocks = vi.hoisted(() => ({
  deleteClientAppState: vi.fn(async () => {}),
  readClientAppState: vi.fn(async () => null),
  setClientAppState: vi.fn(async () => {}),
}));

vi.mock("../agent-chat.js", () => chatMocks);
vi.mock("../application-state.js", () => appStateMocks);

import { useDbAdminAgentSync } from "./useAgentSync.js";

function Harness({
  enabled,
  table,
}: {
  enabled?: boolean;
  table: string | null;
}) {
  useDbAdminAgentSync({ enabled, table, mode: "table" });
  return null;
}

describe("useDbAdminAgentSync", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true })),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("does not clear selected-object state when sync is disabled", () => {
    act(() => {
      root.render(<Harness enabled={false} table="dashboards" />);
    });

    expect(chatMocks.removeAgentChatContextItem).not.toHaveBeenCalled();
    expect(appStateMocks.deleteClientAppState).not.toHaveBeenCalled();
    expect(appStateMocks.setClientAppState).not.toHaveBeenCalled();
  });

  it("only deletes selected-object state when this tab owns it", async () => {
    appStateMocks.readClientAppState.mockResolvedValueOnce({
      type: "dashboard",
      __agentNativeSelectedObjectSource: "other-tab",
    });

    await act(async () => {
      root.render(<Harness enabled table={null} />);
    });

    expect(appStateMocks.readClientAppState).toHaveBeenCalledWith(
      "selected-object",
    );
    expect(appStateMocks.deleteClientAppState).not.toHaveBeenCalled();
  });
});
