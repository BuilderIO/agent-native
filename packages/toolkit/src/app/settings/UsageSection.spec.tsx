// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queries: [] as Array<{ name: string; enabled: boolean | undefined }>,
}));

const metrics = {
  billing: { unit: "usd", label: "Estimated spend", shortLabel: "Cost" },
  app: "mail",
  viewScope: "me",
  selectedUserEmail: null,
  availableUsers: [],
  access: { canViewWorkspace: true, totalUsers: 1 },
  totals: {
    costCents: 150,
    calls: 3,
    inputTokens: 100,
    outputTokens: 50,
    activeUsers: 1,
  },
  currentDay: { costCents: 0, credits: 0, calls: 0, tokens: 0 },
  byLabel: [],
  byModel: [],
  daily: [],
  recent: [],
};

const creditUsage = {
  plan: "paid",
  balance: 50,
  quota: { period: "monthly", limit: 100, used: 50, remaining: 50 },
};

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (
    name: string,
    _params: unknown,
    options?: { enabled?: boolean },
  ) => {
    state.queries.push({ name, enabled: options?.enabled });
    const enabled = options?.enabled ?? true;
    const data =
      name === "get-usage-metrics"
        ? metrics
        : name === "get-builder-credit-usage" && enabled
          ? creditUsage
          : name === "get-usage-alerts"
            ? { rules: [] }
            : undefined;
    return {
      data,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    String(options?.defaultValue ?? key).replace(
      /\{\{\s*(\w+)\s*\}\}/g,
      (_, name: string) => String(options?.[name] ?? ""),
    ),
}));

vi.mock("../chat/index.js", () => ({
  BuilderReferralInviteRow: () => null,
}));

import { UsageSection } from "./UsageSection.js";

let container: HTMLDivElement;
let root: Root;

function render() {
  act(() =>
    root.render(
      <MemoryRouter>
        <UsageSection />
      </MemoryRouter>,
    ),
  );
}

function creditQuery() {
  return state.queries.filter(
    (query) => query.name === "get-builder-credit-usage",
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.queries = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("UsageSection credit panel", () => {
  it("shows the workspace credit balance to admins by default", () => {
    render();

    expect(creditQuery().at(-1)?.enabled).toBe(true);
    expect(container.textContent).toContain("Builder credits");
  });

  it("does not read or show credits where commercial surfaces are hidden", () => {
    vi.stubGlobal("__AGENT_NATIVE_APP_CONFIG__", {
      billing: { commercialSurfaces: "hide" },
    });
    render();

    expect(creditQuery().every((query) => query.enabled === false)).toBe(true);
    expect(container.textContent).not.toMatch(/credits?\b/i);
    expect(container.textContent).toContain("$1.50");
  });
});
