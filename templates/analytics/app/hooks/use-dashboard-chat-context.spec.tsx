// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  agentContextItems: [] as Array<{
    key: string;
    title: string;
    context: string;
  }>,
  deleteClientAppState: vi.fn(async () => {}),
  getBrowserTabId: vi.fn(() => "test-tab"),
  readClientAppState: vi.fn(async () => null),
  removeAgentChatContextItem: vi.fn(),
  setAgentChatContextItem: vi.fn(),
  setClientAppState: vi.fn(async () => {}),
  useAgentChatContext: vi.fn(() => ({
    items: clientMocks.agentContextItems,
    updatedAt: 0,
  })),
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

function PanelHarness() {
  const { selectedPanelId, selectPanelForChat } = useDashboardChatContext({
    id: "dash-1",
    kind: "sql",
    title: "Revenue",
  });
  return (
    <button
      data-selected={selectedPanelId === "panel-1" ? "true" : "false"}
      onClick={() =>
        selectPanelForChat({
          panelId: "panel-1",
          panelTitle: "ARR by month",
          panelKind: "chart",
          chartType: "line",
          source: "bigquery",
        })
      }
    />
  );
}

describe("useDashboardChatContext", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.agentContextItems = [];
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

  it.each([
    [
      "dashboard",
      {
        type: "dashboard",
        id: "dash-2",
        __agentNativeSelectedObjectSource: TAB_ID,
      },
    ],
    [
      "dashboard panel",
      {
        type: "dashboard-panel",
        dashboardId: "dash-2",
        panelId: "panel-2",
        __agentNativeSelectedObjectSource: TAB_ID,
      },
    ],
  ])(
    "does not let old dashboard cleanup clear the next page's %s selection",
    async (_selectionKind, currentSelection) => {
      let resolveRead!: (value: Record<string, unknown>) => void;
      clientMocks.readClientAppState.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }) as any,
      );

      await act(async () => {
        root.render(<Harness id="dash-1" />);
      });
      await act(async () => {
        root.render(<Harness id="dash-2" />);
      });
      await act(async () => {
        resolveRead(currentSelection);
      });

      expect(clientMocks.deleteClientAppState).not.toHaveBeenCalled();
    },
  );

  it("stages a selected panel for chat and app state", async () => {
    await act(async () => {
      root.render(<PanelHarness />);
    });

    const button = container.querySelector("button");
    await act(async () => {
      button?.click();
    });

    expect(clientMocks.setAgentChatContextItem).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "analytics-selected-dashboard-panel",
        title: "ARR by month",
        context: expect.stringContaining("Panel id: panel-1"),
        openSidebar: true,
        focus: false,
      }),
    );
    expect(clientMocks.setClientAppState).toHaveBeenCalledWith(
      "selected-object",
      expect.objectContaining({
        type: "dashboard-panel",
        dashboardId: "dash-1",
        panelId: "panel-1",
        panelKind: "chart",
      }),
      expect.objectContaining({ requestSource: TAB_ID }),
    );
  });

  it("reports the panel selected when its context chip is active", async () => {
    clientMocks.agentContextItems = [
      {
        key: "analytics-selected-dashboard-panel",
        title: "ARR by month",
        context:
          "Analytics panel selection: dashboard=dash-1; panel=panel-1\nPanel id: panel-1",
      },
    ];

    await act(async () => {
      root.render(<PanelHarness />);
    });

    expect(container.querySelector("button")?.dataset.selected).toBe("true");
  });
});
