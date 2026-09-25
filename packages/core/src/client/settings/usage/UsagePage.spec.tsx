// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import englishMessages from "../../../localization/core-messages/en-US.js";
import type { SettingsPageContext } from "../shell/registry.js";
import type { UsageMetricsData } from "./usage-model.js";

const state = vi.hoisted(() => ({
  metrics: undefined as unknown,
  alerts: [] as unknown[],
  calls: [] as Array<{ name: string; params: unknown }>,
  mutations: [] as Array<{ name: string; input: unknown }>,
}));

vi.mock("../../use-action.js", () => ({
  useActionQuery: (name: string, params: unknown) => {
    state.calls.push({ name, params });
    if (name === "get-usage-metrics") {
      return {
        data: state.metrics,
        isError: false,
        isLoading: false,
        isFetching: false,
        isPlaceholderData: false,
        refetch: vi.fn(),
      };
    }
    return {
      data: name === "get-usage-alerts" ? state.alerts : undefined,
      isError: false,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
  useActionMutation: (name: string) => ({
    mutate: (input: unknown) => state.mutations.push({ name, input }),
    isPending: false,
  }),
}));

vi.mock("../../i18n.js", () => ({
  useT:
    () =>
    (key: string, options?: Record<string, unknown>): string => {
      const flat = englishMessages as Record<string, string>;
      const base = key.replace(/^agentChat\./, "");
      const count = options?.count;
      const plural =
        typeof count === "number"
          ? flat[`${base}_${count === 1 ? "one" : "other"}`]
          : undefined;
      const template = plural ?? flat[base] ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(options?.[name] ?? ""),
      );
    },
  useFormatters: () => ({
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat("en-US", options).format(value),
    formatDate: (
      value: Date | number | string,
      options?: Intl.DateTimeFormatOptions,
    ) => new Intl.DateTimeFormat("en-US", options).format(new Date(value)),
  }),
}));

const { UsagePage } = await import("./UsagePage.js");

const NOW = Date.UTC(2026, 8, 25, 12);

function metrics(overrides: Partial<UsageMetricsData> = {}): UsageMetricsData {
  return {
    builderCreditUsageEnabled: false,
    billing: { unit: "usd" },
    appScope: "all",
    appKey: null,
    currentAppKey: "clips",
    apps: [
      { key: "clips", calls: 2 },
      { key: "mail", calls: 1 },
    ],
    viewScope: "me",
    selectedUserEmail: "member@example.com",
    sinceDays: 30,
    generatedAt: NOW,
    access: { viewerEmail: "member@example.com", canViewWorkspace: false },
    totals: {
      costCents: 150,
      calls: 3,
      inputTokens: 1_000,
      outputTokens: 200,
      activeUsers: 1,
    },
    byApp: [],
    byUser: [],
    daily: [{ date: "2026-09-25", costCents: 150, calls: 3, tokens: 1_200 }],
    dailyBy: {
      feature: [
        {
          date: "2026-09-25",
          key: "chat",
          costCents: 150,
          calls: 3,
          tokens: 1_200,
        },
      ],
      app: [],
      model: [],
      surface: [],
    },
    topChats: [
      {
        threadId: "thread-1",
        title: "Q3 planning recap",
        titleSource: "thread",
        ownerEmail: "member@example.com",
        app: "clips",
        lastActiveAt: NOW,
        calls: 2,
        costCents: 100,
      },
    ],
    toolCalls: { status: "ok", daily: [] },
    recent: [],
    ...overrides,
  };
}

const member: SettingsPageContext = {
  role: "member",
  isOwner: false,
  isAdmin: false,
  hasOrganization: true,
  appId: "clips",
  labs: {},
  flags: {},
};
const admin: SettingsPageContext = { ...member, role: "admin", isAdmin: true };

let root: Root | null = null;
let container: HTMLDivElement;

function render(context: SettingsPageContext) {
  act(() => {
    root = createRoot(container);
    root.render(<UsagePage context={context} />);
  });
}

function button(label: string, scope: ParentNode = document.body) {
  const match = [...scope.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!match) throw new Error(`No "${label}" button`);
  return match;
}

function metricsParams() {
  return state.calls.filter((call) => call.name === "get-usage-metrics").at(-1)
    ?.params;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.calls = [];
  state.alerts = [];
  state.mutations = [];
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("UsagePage", () => {
  it("shows a member only their own usage across all apps, in dollars", () => {
    state.metrics = metrics();
    render(member);

    expect(metricsParams()).toEqual({
      sinceDays: 30,
      scope: "me",
      app: "all",
    });
    expect(container.querySelector('[aria-label="People"]')).toBeNull();
    expect(container.textContent).toContain("Your estimated spend");
    expect(container.textContent).toContain("$1.50");
    expect(container.textContent).not.toContain("Active people");
    expect(container.textContent).toContain("Q3 planning recap");
    expect(container.textContent).not.toContain("Top people");
  });

  it("opens owners and admins on Everyone with the people switch", () => {
    state.metrics = metrics({
      viewScope: "workspace",
      selectedUserEmail: null,
      access: { viewerEmail: "admin@example.com", canViewWorkspace: true },
      totals: {
        costCents: 900,
        calls: 9,
        inputTokens: 1_000,
        outputTokens: 200,
        activeUsers: 3,
      },
      byUser: [
        {
          key: "member@example.com",
          costCents: 600,
          calls: 6,
          inputTokens: 0,
          outputTokens: 0,
          activeUsers: 1,
        },
        {
          key: "admin@example.com",
          costCents: 300,
          calls: 3,
          inputTokens: 0,
          outputTokens: 0,
          activeUsers: 1,
        },
      ],
    });
    render(admin);

    expect(metricsParams()).toEqual({
      sinceDays: 30,
      scope: "workspace",
      app: "all",
    });
    expect(container.querySelector('[aria-label="People"]')).not.toBeNull();
    expect(container.textContent).toContain("Estimated spend");
    expect(container.textContent).not.toContain("Your estimated spend");
    expect(container.textContent).toContain("Active people");
    expect(container.textContent).toContain("Top people");
    expect(container.textContent).toContain("member@example.com");
  });

  it("shows Builder.io credits when the agent runs on Builder.io", () => {
    state.metrics = metrics({
      billing: {
        unit: "builder-credits",
        hardCostMarginMultiplier: 1.25,
        creditsPerUsd: 20,
      },
    });
    render(member);

    expect(container.textContent).toContain("Your Builder.io credit spend");
    expect(container.textContent).toContain("38 credits");
    expect(container.textContent).not.toContain("$1.50");
  });

  it("tells a failed chat read apart from a missing title or prompt", () => {
    const chat = metrics().topChats[0]!;
    state.metrics = metrics({
      topChats: [
        { ...chat, threadId: "a", title: null, titleSource: "unavailable" },
        { ...chat, threadId: "b", title: null, titleSource: "not-captured" },
      ],
      recent: [
        {
          id: 1,
          createdAt: NOW,
          ownerEmail: "member@example.com",
          app: "clips",
          model: "model-a",
          prompt: null,
          promptSource: "unavailable",
          costCents: 10,
        },
        {
          id: 2,
          createdAt: NOW,
          ownerEmail: "member@example.com",
          app: "clips",
          model: "model-a",
          prompt: null,
          promptSource: "not-captured",
          costCents: 10,
        },
      ],
    });
    render(member);

    expect(container.textContent).toContain("Title couldn't be loaded");
    expect(container.textContent).toContain("Untitled chat");

    act(() => {
      button("Activity").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    expect(container.textContent).toContain("Prompt couldn't be loaded");
    expect(container.textContent).toContain("Prompt not captured");
  });

  it("keeps an app rule's app when its alert is saved", () => {
    state.metrics = metrics();
    state.alerts = [
      {
        id: "rule-mail-month",
        appId: "mail",
        unit: "usd",
        period: "month",
        limit: 50,
        channels: ["in-app"],
        enabled: true,
        isDefault: false,
        status: "ok",
        current: 5,
      },
    ];
    render(member);

    const row = container.querySelector("#usage-alert-rule-mail-month");
    expect(row).not.toBeNull();
    act(() => button("Edit", row!).click());
    const form = button("Save").closest("form");
    act(() => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(state.mutations).toEqual([
      {
        name: "manage-usage-alert",
        input: {
          operation: "save",
          scope: "user",
          ruleId: "rule-mail-month",
          appId: "mail",
          unit: "usd",
          period: "month",
          limit: 50,
          channels: ["in-app"],
          enabled: true,
        },
      },
    ]);
  });
});
