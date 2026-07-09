// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  deleteClientAppState: vi.fn(async () => {}),
  getBrowserTabId: vi.fn(() => "test-tab"),
  readClientAppState: vi.fn(async () => null),
  removeAgentChatContextItem: vi.fn(),
  setAgentChatContextItem: vi.fn(),
  setClientAppState: vi.fn(async () => {}),
}));

vi.mock("@agent-native/core/client", () => clientMocks);

import { TAB_ID } from "@/lib/tab-id";

import { useDashboardChatContext } from "./use-dashboard-chat-context";

function Harness({ id }: { id: string | null }) {
  useDashboardChatContext({
    id,
    kind: "explorer",
    title: id ? "Revenue" : null,
  });
  return null;
}

describe("useDashboardChatContext", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("tags selected-object state with the current tab id", async () => {
    await act(async () => {
      root.render(<Harness id="dash-1" />);
    });

    expect(clientMocks.setClientAppState).toHaveBeenCalledWith(
      "selected-object",
      expect.objectContaining({
        id: "dash-1",
        __agentNativeSelectedObjectSource: TAB_ID,
      }),
      expect.objectContaining({ requestSource: TAB_ID }),
    );
  });

  it("does not clear selected-object state owned by another tab", async () => {
    clientMocks.readClientAppState.mockResolvedValueOnce({
      type: "dashboard",
      id: "dash-2",
      __agentNativeSelectedObjectSource: "other-tab",
    } as any);

    await act(async () => {
      root.render(<Harness id="dash-1" />);
    });
    await act(async () => {
      root.render(<Harness id={null} />);
    });

    expect(clientMocks.readClientAppState).toHaveBeenCalledWith(
      "selected-object",
    );
    expect(clientMocks.deleteClientAppState).not.toHaveBeenCalled();
  });
});
