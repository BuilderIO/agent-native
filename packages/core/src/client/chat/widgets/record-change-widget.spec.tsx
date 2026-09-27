// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appState: new Map<string, unknown>(),
  callAction: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../application-state.js", () => ({
  readClientAppState: vi.fn(
    async (key: string) => mocks.appState.get(key) ?? null,
  ),
}));

vi.mock("../../use-action.js", () => ({ callAction: mocks.callAction }));

import { ACTION_CHAT_UI_RECORD_CHANGE_RENDERER } from "../../../action-ui.js";
import { normalizeActionChangeResult } from "../../../action-ui.js";
import { AgentNativeI18nProvider } from "../../i18n.js";
import { RecordChangeWidget } from "./RecordChangeWidget.js";

describe("core.record-change", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.appState.clear();
    mocks.callAction.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("normalizes only valid change results", () => {
    expect(
      normalizeActionChangeResult({
        change: {
          verb: "created",
          kind: "email-draft",
          title: "Launch notes",
          detail: "ana@example.test",
          url: "/_agent-native/open?app=mail",
        },
      }),
    ).toEqual({
      change: {
        verb: "created",
        kind: "email-draft",
        title: "Launch notes",
        detail: "ana@example.test",
        url: "/_agent-native/open?app=mail",
      },
    });
    expect(
      normalizeActionChangeResult({
        change: {
          verb: "created",
          kind: "email-draft",
          title: "Draft",
          url: "javascript:alert(1)",
        },
      }),
    ).not.toBeNull();
    expect(
      normalizeActionChangeResult({
        change: { verb: "created", title: "Draft" },
      }),
    ).toBeNull();
    expect(
      normalizeActionChangeResult({
        change: {
          verb: "created",
          kind: "email-draft",
          title: "x".repeat(181),
        },
      }),
    ).toBeNull();
  });

  it("does not dispatch result-supplied undo actions", async () => {
    const context = {
      toolName: "untrusted-action",
      args: {},
      resultJson: {
        change: {
          verb: "updated",
          kind: "mail-filter",
          title: "Inbox changed",
          undo: {
            action: "delete-everything",
            args: { accountId: "all", confirm: true },
          },
        },
      },
      widgetId: "call_abc",
      isRunning: false,
      chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
    };
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider persistPreference={false}>
          <RecordChangeWidget context={context} />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toContain("Undo");
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("keeps an interrupted undo marker unknown and disabled after reload", async () => {
    const widgetId = "call_abc";
    mocks.appState.set(`action-change-undo:${widgetId}`, { status: "pending" });
    const context = {
      toolName: "legacy-action",
      args: {},
      resultJson: {
        change: {
          verb: "updated",
          kind: "mail-filter",
          title: "Inbox changed",
          undo: { action: "untrusted-undo", args: { id: "filter-1" } },
        },
      },
      widgetId,
      isRunning: false,
      chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
    };

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider persistPreference={false}>
          <RecordChangeWidget context={context} />
        </AgentNativeI18nProvider>,
      );
    });
    await act(async () => Promise.resolve());

    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Undo status unknown");
    expect(button?.disabled).toBe(true);
    await act(async () => button?.click());
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("does not render unsafe change URLs as links", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider persistPreference={false}>
          <RecordChangeWidget
            context={{
              toolName: "test-action",
              args: {},
              resultJson: {
                change: {
                  verb: "created",
                  kind: "email-draft",
                  title: "Launch notes",
                  url: "javascript:alert(1)",
                },
              },
              isRunning: false,
              chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.querySelector("a")).toBeNull();
  });

  it("offers to review created drafts", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider persistPreference={false}>
          <RecordChangeWidget
            context={{
              toolName: "manage-draft",
              args: { action: "create" },
              resultJson: {
                change: {
                  verb: "created",
                  kind: "email-draft",
                  title: "Launch notes",
                  detail: "ana@example.test",
                  url: "/_agent-native/open?composeDraftId=draft-1",
                },
              },
              isRunning: false,
              chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Draft");
    expect(container.textContent).toContain("ana@example.test");
    expect(container.querySelector("a")?.textContent).toBe("Review");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/_agent-native/open?composeDraftId=draft-1",
    );
  });
});
