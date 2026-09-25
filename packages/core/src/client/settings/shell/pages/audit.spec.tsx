// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditEvent } from "../../../../audit/types.js";
import englishMessages from "../../../../localization/core-messages/en-US.js";

const callActionMock = vi.hoisted(() => vi.fn());
const detailInput = vi.hoisted(() => ({ value: null as string | null }));
const queriedActions = vi.hoisted(() => [] as Array<[string, unknown]>);

vi.mock("../../../use-action.js", () => ({
  callAction: callActionMock,
  defaultActionQueryRetry: () => false,
  defaultActionQueryRetryDelay: () => 0,
  useActionQuery: (name: string, params: unknown, options?: any) => {
    queriedActions.push([name, params]);
    if (name === "list-audit-events") {
      return { data: { events: [], apps: ["clips", "mail"] } };
    }
    if (options?.enabled === false) return { data: undefined };
    return {
      data: { event: { input: detailInput.value } },
      isLoading: false,
      isError: false,
    };
  },
}));

vi.mock("../../../i18n.js", () => ({
  useT:
    () =>
    (key: string, options?: Record<string, unknown>): string => {
      const flat = englishMessages as Record<string, string>;
      const template = flat[key.replace(/^agentChat\./, "")] ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(options?.[name] ?? ""),
      );
    },
  useFormatters: () => ({
    formatDate: (value: number, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(
        new Date(value),
      ),
  }),
}));

import AuditLogSettingsPage from "./audit.js";

const NOW = Date.UTC(2026, 8, 25, 12);

function event(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: over.id ?? "evt-1",
    createdAt: over.createdAt ?? Date.UTC(2026, 8, 23, 10),
    action: "set-agent-default-model",
    caller: "frontend",
    actorKind: "human",
    actorEmail: "admin@example.com",
    orgId: "org-1",
    threadId: null,
    turnId: null,
    targetType: "agent-default-model",
    targetId: "org-1",
    status: "success",
    summary: "Changed the default model to Claude Sonnet 5",
    input: null,
    errorCode: null,
    ownerEmail: "admin@example.com",
    visibility: "admins",
    app: "clips",
    ...over,
  };
}

function page(events: AuditEvent[], nextOffset: number | null) {
  return { events, hasMore: nextOffset !== null, nextOffset };
}

let root: Root;
let container: HTMLDivElement;

async function render() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AuditLogSettingsPage />
      </QueryClientProvider>,
    );
  });
  await flush();
}

async function flush() {
  for (let tick = 0; tick < 4; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function rows(): HTMLElement[] {
  return Array.from(container.querySelectorAll("[data-audit-event]"));
}

function showMoreButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.startsWith("Show "),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  callActionMock.mockReset();
  queriedActions.length = 0;
  detailInput.value = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("Audit log page", () => {
  it("reads the organization trail for the last 30 days", async () => {
    callActionMock.mockResolvedValue(page([event()], null));
    await render();

    const [name, params, options] = callActionMock.mock.calls[0];
    expect(name).toBe("list-audit-events");
    expect(params).toMatchObject({
      scope: "organization",
      sinceMs: NOW - 30 * 24 * 60 * 60 * 1000,
      limit: 25,
      offset: 0,
    });
    expect(params).not.toHaveProperty("app");
    expect(options).toMatchObject({ method: "GET" });
    expect(queriedActions).toContainEqual([
      "list-audit-events",
      { scope: "organization", limit: 1, includeApps: true },
    ]);
  });

  it("shows what changed, then date, app, and who, with the agent as actor", async () => {
    callActionMock.mockResolvedValue(
      page(
        [
          event({ id: "human" }),
          event({
            id: "agent",
            actorKind: "agent",
            actorEmail: "member@example.com",
            summary: "Turned on Require citations",
            app: "brain",
          }),
          event({
            id: "refused",
            actorEmail: "member@example.com",
            status: "denied",
            app: null,
          }),
        ],
        null,
      ),
    );
    await render();

    const [human, agent, refused] = rows();
    expect(human.textContent).toContain(
      "Changed the default model to Claude Sonnet 5",
    );
    expect(human.textContent).toContain("Sep 23 · Clips · admin@example.com");
    expect(agent.textContent).toContain("Sep 23 · Brain · Agent");
    expect(agent.textContent).not.toContain("member@example.com");
    expect(refused.textContent).toContain("Refused");
    expect(refused.textContent).toContain("Sep 23 · member@example.com");
  });

  it("names the real count in Show N more and reveals the next page", async () => {
    const first = Array.from({ length: 25 }, (_, index) =>
      event({ id: `a-${index}` }),
    );
    const second = Array.from({ length: 3 }, (_, index) =>
      event({ id: `b-${index}` }),
    );
    callActionMock.mockImplementation(
      async (_name: string, params: { offset: number }) =>
        params.offset === 0 ? page(first, 25) : page(second, null),
    );
    await render();

    expect(rows()).toHaveLength(25);
    expect(showMoreButton()?.textContent).toBe("Show 3 more");

    await act(async () => {
      showMoreButton()!.click();
    });
    await flush();
    expect(rows()).toHaveLength(28);
    expect(showMoreButton()).toBeUndefined();
    expect(
      callActionMock.mock.calls.map(([, params]) => params.offset),
    ).toEqual([0, 25]);
  });

  it("says when the period has no changes", async () => {
    callActionMock.mockResolvedValue(page([], null));
    await render();
    expect(container.textContent).toContain("No changes in this period.");
    expect(showMoreButton()).toBeUndefined();
  });

  it("shows a load failure with a retry instead of an empty log", async () => {
    callActionMock.mockRejectedValue(new Error("403"));
    await render();
    expect(container.textContent).toContain("Could not load the audit log.");
    expect(container.textContent).not.toContain("No changes in this period.");
  });

  it("opens the event detail from a row", async () => {
    detailInput.value = JSON.stringify({ model: "claude-sonnet-5" });
    callActionMock.mockResolvedValue(
      page(
        [
          event({
            actorKind: "agent",
            actorEmail: "member@example.com",
          }),
        ],
        null,
      ),
    );
    await render();

    await act(async () => {
      rows()[0].click();
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(
      "Changed the default model to Claude Sonnet 5",
    );
    expect(dialog?.textContent).toContain("On behalf of");
    expect(dialog?.textContent).toContain("member@example.com");
    expect(dialog?.textContent).toContain("set-agent-default-model");
    expect(dialog?.textContent).toContain('"model": "claude-sonnet-5"');
    expect(queriedActions).toContainEqual(["get-audit-event", { id: "evt-1" }]);
  });
});
