// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const appState = new Map<string, unknown>();
  return {
    appState,
    callAction: vi.fn(async () => ({ ok: true })),
    compareAndSetAppState: vi.fn(
      async (
        key: string,
        expected: Record<string, unknown> | null,
        next: Record<string, unknown> | null,
      ) => {
        const current = appState.get(key) ?? null;
        if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
        if (next === null) appState.delete(key);
        else appState.set(key, next);
        return true;
      },
    ),
    setAppState: vi.fn(async (key: string, value: unknown) => {
      appState.set(key, value);
    }),
  };
});

vi.mock("@agent-native/core/client/application-state", () => ({
  readClientAppState: vi.fn(
    async (key: string) => mocks.appState.get(key) ?? null,
  ),
  compareAndSetClientAppState: mocks.compareAndSetAppState,
  setClientAppState: mocks.setAppState,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));

import { ACTION_CHAT_UI_RECORD_CHANGE_RENDERER } from "@agent-native/core/action-ui";
import { normalizeActionChangeResult } from "@agent-native/core/action-ui";
import {
  AgentNativeI18nProvider as CoreAgentNativeI18nProvider,
  type AgentNativeI18nProviderProps,
} from "@agent-native/core/client/i18n";

import { createToolkitI18nCatalog } from "../../../i18n.js";
import { RecordChangeWidget } from "./RecordChangeWidget.js";

const toolkitI18nCatalog = createToolkitI18nCatalog({ messages: {} });

function AgentNativeI18nProvider(props: AgentNativeI18nProviderProps) {
  return (
    <CoreAgentNativeI18nProvider
      {...props}
      catalog={props.catalog ?? toolkitI18nCatalog}
    />
  );
}

describe("core.record-change", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.appState.clear();
    mocks.callAction.mockClear();
    mocks.compareAndSetAppState.mockClear();
    mocks.setAppState.mockClear();
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
          undo: { action: "legacy-action", args: { id: "filter-1" } },
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

  it("runs only same-action undo and preserves Undone after reload", async () => {
    const widgetId = "call_undoable";
    const context = {
      toolName: "manage-gmail-filters",
      args: {},
      resultJson: {
        change: {
          verb: "created",
          kind: "gmail-filter",
          title: "Newsletters",
          undo: {
            action: "manage-gmail-filters",
            args: { operation: "delete", id: "filter-1" },
          },
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

    const undoButton = container.querySelector("button");
    expect(undoButton?.textContent).toBe("Undo");
    await act(async () => undoButton?.click());

    expect(mocks.callAction).toHaveBeenCalledWith("manage-gmail-filters", {
      operation: "delete",
      id: "filter-1",
    });
    expect(mocks.appState.get(`action-change-undo:${widgetId}`)).toEqual({
      status: "undone",
    });
    expect(container.textContent).toContain("Undone");
    expect(container.querySelector("button")).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider persistPreference={false}>
          <RecordChangeWidget context={context} />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Undone");
    expect(container.querySelector("button")).toBeNull();
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
  });

  it("allows only one of two open cards to run the same undo", async () => {
    const context = {
      toolName: "manage-gmail-filters",
      args: {},
      resultJson: {
        change: {
          verb: "created",
          kind: "gmail-filter",
          title: "Newsletters",
          undo: {
            action: "manage-gmail-filters",
            args: { operation: "delete", id: "filter-1" },
          },
        },
      },
      widgetId: "call_shared_undo",
      isRunning: false,
      chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
    };

    await act(async () => {
      root.render(
        <>
          <AgentNativeI18nProvider persistPreference={false}>
            <RecordChangeWidget context={context} />
          </AgentNativeI18nProvider>
          <AgentNativeI18nProvider persistPreference={false}>
            <RecordChangeWidget context={context} />
          </AgentNativeI18nProvider>
        </>,
      );
    });
    await vi.waitFor(() => {
      expect(container.querySelectorAll("button")).toHaveLength(2);
      expect(
        [...container.querySelectorAll("button")].every(
          (b) => b.textContent === "Undo",
        ),
      ).toBe(true);
    });

    await act(async () => {
      for (const button of container.querySelectorAll("button")) button.click();
      await vi.waitFor(() => expect(mocks.callAction).toHaveBeenCalledTimes(1));
    });

    expect(mocks.compareAndSetAppState).toHaveBeenCalledTimes(2);
    expect(mocks.appState.get("action-change-undo:call_shared_undo")).toEqual({
      status: "undone",
    });
    expect(container.textContent?.match(/Undone/g)).toHaveLength(1);
    expect(container.textContent).toContain("Undo status unknown");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector("button")?.disabled).toBe(true);
  });

  it("keeps each grouped undo bound to its originating action", async () => {
    const context = {
      toolName: "manage-gmail-filters",
      args: {},
      resultJson: {},
      relatedResults: [
        {
          widgetId: "call_filter",
          toolName: "manage-gmail-filters",
          result: {
            change: {
              verb: "created",
              kind: "gmail-filter",
              title: "Newsletters",
              undo: {
                action: "manage-gmail-filters",
                args: { operation: "delete", id: "filter-1" },
              },
            },
          },
        },
        {
          widgetId: "call_rule",
          toolName: "manage-email-rules",
          result: {
            change: {
              verb: "created",
              kind: "mail-rule",
              title: "Receipts",
              undo: {
                action: "manage-email-rules",
                args: { operation: "delete", id: "rule-1" },
              },
            },
          },
        },
      ],
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

    expect(container.textContent).toContain("2 changes");
    const undoButtons = [...container.querySelectorAll("button")];
    expect(undoButtons.map((button) => button.textContent)).toEqual([
      "Undo",
      "Undo",
    ]);
    await act(async () => {
      undoButtons[0]?.click();
      undoButtons[1]?.click();
    });

    expect(mocks.callAction.mock.calls).toEqual([
      ["manage-gmail-filters", { operation: "delete", id: "filter-1" }],
      ["manage-email-rules", { operation: "delete", id: "rule-1" }],
    ]);
    expect(container.textContent).toContain("2 changes");
    expect(container.textContent).toContain("Undone");
    expect(container.querySelectorAll("button")).toHaveLength(0);
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

    for (const [visibility, label] of [
      ["private", "Private"],
      ["org", "Organization"],
      ["public", "Public"],
    ]) {
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
                    detail: visibility,
                  },
                },
                isRunning: false,
                chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
              }}
            />
          </AgentNativeI18nProvider>,
        );
      });

      expect(container.textContent).toContain(label);
      expect(container.textContent).not.toContain(visibility);
    }
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

  it("localizes appearance preset ids in change cards", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="es-ES"
          initialPreference="es-ES"
          persistPreference={false}
        >
          <RecordChangeWidget
            context={{
              toolName: "change-appearance",
              args: {},
              resultJson: {
                change: {
                  verb: "updated",
                  kind: "appearance",
                  title: "ocean",
                },
              },
              isRunning: false,
              chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });

    await vi.waitFor(() => expect(container.textContent).toContain("Océano"));
    expect(container.textContent).not.toContain("ocean");
  });

  it("localizes system values in preference change cards", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="fr-FR"
          initialPreference="fr-FR"
          persistPreference={false}
        >
          <RecordChangeWidget
            context={{
              toolName: "set-localization-preference",
              args: {},
              resultJson: {
                change: {
                  verb: "updated",
                  kind: "preference",
                  title: "system · system",
                },
              },
              isRunning: false,
              chatUI: { renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER },
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });

    await vi.waitFor(() =>
      expect(container.textContent).toContain("Automatique · Automatique"),
    );
    expect(container.textContent).not.toContain("system");
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
