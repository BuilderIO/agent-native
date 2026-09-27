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

  it("preserves only a boolean fallback-title marker", () => {
    expect(
      normalizeActionChangeResult({
        change: {
          verb: "created",
          kind: "booking-link",
          title: "Booking link",
          titleIsFallback: true,
        },
      }),
    ).toEqual({
      change: {
        verb: "created",
        kind: "booking-link",
        title: "Booking link",
        titleIsFallback: true,
      },
    });
    expect(
      normalizeActionChangeResult({
        change: {
          verb: "created",
          kind: "booking-link",
          title: "Booking link",
          titleIsFallback: "true",
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

  it("shows saved drafts as awaiting review with a review and edit action", async () => {
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

    expect(container.textContent).toContain("Awaiting review");
    expect(container.textContent).toContain(
      "Saved to drafts · ana@example.test",
    );
    expect(container.querySelector("a")?.textContent).toBe("Review / edit");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/_agent-native/open?composeDraftId=draft-1",
    );
  });

  it("uses the filter icon for Mail rule changes", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider persistPreference={false}>
          <RecordChangeWidget
            context={{
              toolName: "manage-email-rules",
              args: { action: "create" },
              resultJson: {
                change: {
                  verb: "created",
                  kind: "mail-rule",
                  title: "Newsletters",
                  detail: "from newsletters",
                  url: "/_agent-native/open?app=mail&view=settings",
                },
              },
              isRunning: false,
              chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.querySelector("svg")?.getAttribute("class")).toMatch(
      /filter/i,
    );
  });

  it("localizes sharing roles and visibility in action cards", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider persistPreference={false}>
          <RecordChangeWidget
            context={{
              toolName: "share-resource",
              args: {},
              resultJson: {
                change: {
                  verb: "created",
                  kind: "resource-share",
                  title: "Product plan",
                  detail: "user:ana@example.test · editor",
                },
              },
              isRunning: false,
              chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("ana@example.test · Editor");
    expect(container.textContent).not.toContain("user:");
    expect(container.querySelector("svg")?.getAttribute("class")).toMatch(
      /share/i,
    );

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider persistPreference={false}>
          <RecordChangeWidget
            context={{
              toolName: "set-resource-visibility",
              args: {},
              resultJson: {
                change: {
                  verb: "updated",
                  kind: "resource-share",
                  title: "Product plan",
                  detail: "org",
                },
              },
              isRunning: false,
              chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Organization");
  });

  it("renders an available Calendar time with a use-time action", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider persistPreference={false}>
          <RecordChangeWidget
            context={{
              toolName: "find-a-time",
              args: {},
              resultJson: {
                change: {
                  verb: "created",
                  kind: "calendar-time-choice",
                  title: "Internal title is localized by the widget",
                  detail: "Thu, Apr 23 · 10:30–11:15 AM PDT",
                  url: "/_agent-native/open?app=calendar&view=calendar&createSlot=1",
                },
              },
              isRunning: false,
              chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Best shared time");
    expect(container.textContent).toContain("Suggested");
    expect(container.textContent).toContain("Thu, Apr 23 · 10:30–11:15 AM PDT");
    expect(container.querySelector("a")?.textContent).toBe("Use this time");
  });

  it("shows a localized scheduled-email title and local send time", async () => {
    const scheduledAt = "2027-01-03T04:05:00.000Z";
    const formattedTime = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(Date.parse(scheduledAt));
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider persistPreference={false}>
          <RecordChangeWidget
            context={{
              toolName: "create-scheduled-send",
              args: {},
              resultJson: {
                change: {
                  verb: "scheduled",
                  kind: "scheduled-email",
                  title: "Scheduled email",
                  titleIsFallback: true,
                  detail: scheduledAt,
                  url: "/_agent-native/open?app=mail&view=scheduled",
                },
              },
              isRunning: false,
              chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Scheduled email");
    expect(container.textContent).toContain("Scheduled");
    expect(container.textContent).toContain(formattedTime);
    expect(container.querySelector("a")?.textContent).toBe("Open");
  });

  it("localizes booking-link fallback titles and durations", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider persistPreference={false}>
          <RecordChangeWidget
            context={{
              toolName: "create-booking-link",
              args: {},
              resultJson: {
                change: {
                  verb: "created",
                  kind: "booking-link",
                  title: "Booking link",
                  titleIsFallback: true,
                  detail: "30",
                  url: "/_agent-native/open?app=calendar&view=booking-links",
                },
              },
              isRunning: false,
              chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Booking link");
    expect(container.textContent).toContain("30 min");
    expect(container.querySelector("a")?.textContent).toBe("Open");
  });

  it("preserves a user booking-link title that matches the fallback wording", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="es-ES"
          initialPreference="es-ES"
          persistPreference={false}
        >
          <RecordChangeWidget
            context={{
              toolName: "create-booking-link",
              args: {},
              resultJson: {
                change: {
                  verb: "created",
                  kind: "booking-link",
                  title: "Booking link",
                  detail: "30",
                  url: "/_agent-native/open?app=calendar&view=booking-links",
                },
              },
              isRunning: false,
              chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Booking link");
      expect(container.textContent).not.toContain("Enlace de reserva");
    });
  });
});
