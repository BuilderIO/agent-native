// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  SIDEBAR_STATE_CHANGE_EVENT: "agent-panel:state-change",
  agentContextItems: [] as Array<{
    key: string;
    title: string;
    context: string;
  }>,
  callAction: vi.fn(async () => ({ cleared: true })),
  getBrowserTabId: vi.fn(() => "test-tab"),
  removeAgentChatContextItem: vi.fn(),
  setAgentChatContextItem: vi.fn(),
  setClientAppState: vi.fn(async () => {}),
  // Stands in for the composer: an accepted pick becomes a context chip.
  selectAgentSelectable: vi.fn(
    (
      target: {
        kind: string;
        id: string;
        title: string;
        getContext: () => string;
      },
      _options?: Record<string, unknown>,
    ) => {
      clientMocks.agentContextItems = [
        ...clientMocks.agentContextItems,
        {
          key: `agent-select:${target.kind}:${encodeURIComponent(target.id)}`,
          title: target.title,
          context: target.getContext(),
        },
      ];
      return "added";
    },
  ),
  useAgentChatContext: vi.fn(() => ({
    items: clientMocks.agentContextItems,
    updatedAt: 0,
  })),
}));

vi.mock("@agent-native/core/client/agent-chat", async () => {
  const shared = await vi.importActual<
    typeof import("@agent-native/core/shared")
  >("@agent-native/core/shared");
  return {
    SIDEBAR_STATE_CHANGE_EVENT: clientMocks.SIDEBAR_STATE_CHANGE_EVENT,
    agentSelectionContextKey: shared.agentSelectionContextKey,
    parseAgentSelectionContextKey: shared.parseAgentSelectionContextKey,
    listAgentChatContext: () => clientMocks.agentContextItems,
    removeAgentChatContextItem: clientMocks.removeAgentChatContextItem,
    setAgentChatContextItem: clientMocks.setAgentChatContextItem,
    useAgentChatContext: clientMocks.useAgentChatContext,
  };
});

vi.mock("@agent-native/toolkit/app/agent-select", () => ({
  selectAgentSelectable: clientMocks.selectAgentSelectable,
  useAgentSelectable: () => false,
}));

function pickedPanel(index = 0) {
  const call = clientMocks.selectAgentSelectable.mock.calls.at(index);
  if (!call) throw new Error(`No pick at call ${index}`);
  const [target, options] = call;
  return { ...target, context: target.getContext(), options };
}

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: clientMocks.callAction,
  getBrowserTabId: clientMocks.getBrowserTabId,
  setClientAppState: clientMocks.setClientAppState,
}));

import { agentSelectionContextKey } from "@agent-native/core/shared";

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
    <>
      <button
        data-action="passive-select"
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
      <button
        data-action="open-chat"
        onClick={() =>
          selectPanelForChat(
            {
              panelId: "panel-1",
              panelTitle: "ARR by month",
              panelKind: "chart",
              chartType: "line",
              source: "bigquery",
            },
            { openSidebar: true, focus: true },
          )
        }
      />
    </>
  );
}

function MarkerTitleHarness({
  dashboardId = "dash-1",
  panelId = "panel-1",
  source,
}: {
  dashboardId?: string;
  panelId?: string;
  source?: string;
}) {
  const { selectedPanelId, selectPanelForChat } = useDashboardChatContext({
    id: dashboardId,
    kind: "sql",
    title: "REAL_DATA_REQUIRED: signups",
  });
  return (
    <button
      data-action="select"
      data-selected={selectedPanelId === panelId ? "true" : "false"}
      onClick={() =>
        selectPanelForChat(
          {
            panelId,
            panelTitle: "Real_Data_Required by plan",
            panelKind: "chart",
            source,
          },
          { openSidebar: true },
        )
      }
    />
  );
}

function setSidebarOpen(open: boolean) {
  window.dispatchEvent(
    new CustomEvent(clientMocks.SIDEBAR_STATE_CHANGE_EVENT, {
      detail: { open, source: "app", mode: "app" },
    }),
  );
}

async function settleContextPublish() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
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
    await settleContextPublish();

    expect(clientMocks.setClientAppState).toHaveBeenCalledWith(
      "selected-object",
      expect.objectContaining({
        id: "dash-1",
        __agentNativeSelectedObjectSource: TAB_ID,
      }),
      expect.objectContaining({ requestSource: TAB_ID }),
    );
  });

  it("passes its published selection to atomic cleanup on unmount", async () => {
    await act(async () => {
      root.render(<Harness id="dash-1" />);
    });
    await settleContextPublish();
    await act(async () => {
      root.render(<Harness id={null} />);
    });

    expect(clientMocks.callAction).toHaveBeenCalledWith(
      "clear-selected-dashboard-object",
      {
        browserTabId: TAB_ID,
        expectedSelection: expect.objectContaining({
          id: "dash-1",
          __agentNativeSelectedObjectSource: TAB_ID,
        }),
        source: TAB_ID,
      },
    );
  });

  it("clears dashboard context when a fresh chat starts", async () => {
    clientMocks.agentContextItems = [
      {
        key: agentSelectionContextKey("panel", "dash-1/panel-1"),
        title: "ARR by month",
        context: "Panel id: panel-1",
      },
    ];
    await act(async () => {
      root.render(<Harness id="dash-1" />);
    });
    await settleContextPublish();

    await act(async () => {
      window.dispatchEvent(new Event("agent-chat:new-chat"));
    });

    expect(clientMocks.removeAgentChatContextItem).toHaveBeenCalledWith({
      key: "analytics-selected-dashboard",
      openSidebar: false,
    });
    expect(clientMocks.removeAgentChatContextItem).toHaveBeenCalledWith({
      key: "agent-select:panel:dash-1%2Fpanel-1",
      openSidebar: false,
    });
    expect(clientMocks.callAction).toHaveBeenCalledWith(
      "clear-selected-dashboard-object",
      {
        browserTabId: TAB_ID,
        expectedSelection: expect.objectContaining({
          id: "dash-1",
          __agentNativeSelectedObjectSource: TAB_ID,
        }),
        source: TAB_ID,
      },
    );
  });

  it("does not let a pending dashboard publish resurrect context after new chat", async () => {
    await act(async () => {
      root.render(<Harness id="dash-1" />);
    });
    await act(async () => {
      window.dispatchEvent(new Event("agent-chat:new-chat"));
    });
    await settleContextPublish();

    expect(clientMocks.setAgentChatContextItem).not.toHaveBeenCalled();
    expect(clientMocks.setClientAppState).not.toHaveBeenCalledWith(
      "selected-object",
      expect.anything(),
      expect.anything(),
    );
  });

  it("stages a selected panel for chat and app state", async () => {
    await act(async () => {
      root.render(<PanelHarness />);
    });
    await act(async () => setSidebarOpen(true));

    const button = container.querySelector<HTMLButtonElement>(
      '[data-action="passive-select"]',
    );
    await act(async () => {
      button?.click();
    });
    // The composer's context change re-renders the page.
    await act(async () => {
      root.render(<PanelHarness />);
    });

    expect(pickedPanel()).toMatchObject({
      kind: "panel",
      id: "dash-1/panel-1",
      title: "ARR by month",
      context: expect.stringContaining("Panel id: panel-1"),
      options: { exclusive: true, openSidebar: false, focus: false },
    });
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

  it("tells the agent to read only the selected panel, never the whole config", async () => {
    await act(async () => {
      root.render(<PanelHarness />);
    });
    await act(async () => setSidebarOpen(true));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-action="passive-select"]')
        ?.click();
    });

    const { context } = pickedPanel();
    expect(context).toContain('get-sql-dashboard (panelIds: ["panel-1"])');
    expect(context).not.toContain("includeConfig");
  });

  it("ignores passive chart selection while chat is closed", async () => {
    await act(async () => {
      root.render(<PanelHarness />);
    });

    const button = container.querySelector<HTMLButtonElement>(
      '[data-action="passive-select"]',
    );
    await act(async () => button?.click());

    expect(clientMocks.selectAgentSelectable).not.toHaveBeenCalled();
    expect(clientMocks.setClientAppState).not.toHaveBeenCalledWith(
      "selected-object",
      expect.objectContaining({ type: "dashboard-panel" }),
      expect.anything(),
    );
  });

  it("lets the explicit chat action open chat and stage the panel", async () => {
    await act(async () => {
      root.render(<PanelHarness />);
    });

    const button = container.querySelector<HTMLButtonElement>(
      '[data-action="open-chat"]',
    );
    await act(async () => button?.click());

    expect(pickedPanel().options).toEqual({
      exclusive: true,
      openSidebar: true,
      focus: true,
    });
  });

  it("publishes selected-object for a panel picked in Select mode", async () => {
    const panel = {
      panelId: "panel-2",
      panelTitle: "Churn",
      panelKind: "table" as const,
    };
    function CardHarness() {
      const { panelSelectionTarget } = useDashboardChatContext({
        id: "dash-1",
        kind: "sql",
        title: "Revenue",
      });
      panelSelectionTarget(panel);
      return null;
    }
    await act(async () => {
      root.render(<CardHarness />);
    });
    await act(async () => setSidebarOpen(true));
    clientMocks.agentContextItems = [
      {
        key: agentSelectionContextKey("panel", "dash-1/panel-2"),
        title: "Churn",
        context: "Panel id: panel-2",
      },
    ];
    await act(async () => {
      root.render(<CardHarness />);
    });

    expect(clientMocks.setClientAppState).toHaveBeenCalledWith(
      "selected-object",
      expect.objectContaining({
        type: "dashboard-panel",
        panelId: "panel-2",
        panelKind: "table",
      }),
      expect.objectContaining({ requestSource: TAB_ID }),
    );
  });

  it("does not record a selected panel the composer refused", async () => {
    clientMocks.selectAgentSelectable.mockReturnValueOnce("too-many-items");
    await act(async () => {
      root.render(<PanelHarness />);
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-action="open-chat"]')
        ?.click(),
    );

    expect(clientMocks.setClientAppState).not.toHaveBeenCalledWith(
      "selected-object",
      expect.objectContaining({ type: "dashboard-panel" }),
      expect.anything(),
    );
  });

  it("never carries the chat guard's request marker in from a title", async () => {
    await act(async () => {
      root.render(<MarkerTitleHarness />);
    });
    await settleContextPublish();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-action="select"]')
        ?.click(),
    );

    const published = [
      ...clientMocks.setAgentChatContextItem.mock.calls.map(([item]) => item),
      pickedPanel(),
    ];
    expect(published.map(({ title }) => title)).toEqual([
      "Dashboard: REAL DATA REQUIRED: signups",
      "Real Data Required by plan",
    ]);
    for (const { title, context } of published) {
      expect(`${title}\n${context}`).not.toMatch(/real_data_required/i);
    }
    expect(published[1].context).toContain("Panel id: panel-1");
  });

  it("never carries the marker in from an id or the URL, and still reads back the selection", async () => {
    const ids = {
      dashboardId: "real_data_required",
      panelId: "REAL_DATA_REQUIRED-panel",
      source: "REAL_DATA_REQUIRED",
    };
    window.history.replaceState(null, "", "/adhoc/x?from=REAL_DATA_REQUIRED");
    try {
      await act(async () => {
        root.render(<MarkerTitleHarness {...ids} />);
      });
      await settleContextPublish();
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('[data-action="select"]')
          ?.click(),
      );

      const [dashboardItem] =
        clientMocks.setAgentChatContextItem.mock.calls.map(([item]) => item);
      const panel = pickedPanel();
      expect(dashboardItem.context).toContain("Current URL: /adhoc/x?from=");
      // The selection id is listed in the prompt's selected objects too.
      for (const text of [
        dashboardItem.title,
        dashboardItem.context,
        panel.id,
        panel.title,
        panel.context,
      ]) {
        expect(text).not.toMatch(/real_data_required/i);
      }

      // The sidebar keeps the published chip; it must still name this panel.
      clientMocks.agentContextItems = [
        {
          key: agentSelectionContextKey(panel.kind, panel.id),
          title: panel.title,
          context: panel.context,
        },
      ];
      await act(async () => setSidebarOpen(true));
      expect(
        container.querySelector<HTMLButtonElement>('[data-action="select"]')
          ?.dataset.selected,
      ).toBe("true");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("reports the panel selected when its context chip is active", async () => {
    clientMocks.agentContextItems = [
      {
        key: agentSelectionContextKey("panel", "dash-1/panel-1"),
        title: "ARR by month",
        context: "Panel id: panel-1",
      },
    ];

    await act(async () => {
      root.render(<PanelHarness />);
    });
    await act(async () => setSidebarOpen(true));

    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-action="passive-select"]',
      )?.dataset.selected,
    ).toBe("true");
  });

  it("does not report a panel picked on another dashboard", async () => {
    clientMocks.agentContextItems = [
      {
        key: agentSelectionContextKey("panel", "dash-2/panel-1"),
        title: "ARR by month",
        context: "Panel id: panel-1",
      },
    ];

    await act(async () => {
      root.render(<PanelHarness />);
    });
    await act(async () => setSidebarOpen(true));

    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-action="passive-select"]',
      )?.dataset.selected,
    ).toBe("false");
  });

  it("names only the page edits view mode holds back", async () => {
    function ModeHarness() {
      useDashboardChatContext({
        id: "dash-1",
        kind: "sql",
        title: "Revenue",
        canEdit: true,
        editing: false,
      });
      return null;
    }

    await act(async () => {
      root.render(<ModeHarness />);
    });
    await settleContextPublish();

    const { context } = clientMocks.setAgentChatContextItem.mock.calls[0][0];
    expect(context).toContain("Dashboard mode: view");
    expect(context).toContain("column drags stay in their browser");
    expect(context).toContain(
      "saving a view, restoring history, archiving, deleting, and adding a first panel still work",
    );
    expect(context).not.toContain("nothing they do on the page");
  });

  it("publishes once when dashboard metadata arrives in pieces", async () => {
    function MetadataHarness({ panelCount }: { panelCount?: number }) {
      useDashboardChatContext({
        id: "dash-1",
        kind: "sql",
        title: "Revenue",
        panelCount,
      });
      return null;
    }

    await act(async () => {
      root.render(<MetadataHarness />);
    });
    await act(async () => {
      root.render(<MetadataHarness panelCount={2} />);
    });
    await act(async () => {
      root.render(<MetadataHarness panelCount={4} />);
    });
    await settleContextPublish();

    expect(clientMocks.setAgentChatContextItem).toHaveBeenCalledTimes(1);
    expect(clientMocks.setClientAppState).toHaveBeenCalledTimes(1);
    expect(clientMocks.setAgentChatContextItem).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.stringContaining("Panel count: 4"),
      }),
    );
  });
});
