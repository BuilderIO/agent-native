// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { automationIdentity } from "../../lib/automation-display";
import type { DispatchAutomationItem } from "../../lib/automations";
import AutomationsRoute from "./automations";

const automationA: DispatchAutomationItem = {
  id: "auto-a",
  name: "Nightly digest",
  path: "jobs/nightly-digest.md",
  owner: "user@example.com",
  appId: "dispatch",
  scope: "personal",
  enabled: true,
  triggerType: "schedule",
  schedule: "0 6 * * *",
  scheduleDescription: "Every day at 6am",
  lastStatus: "success",
};

const automationB: DispatchAutomationItem = {
  id: "auto-b",
  name: "Error triage",
  path: "jobs/error-triage.md",
  owner: "user@example.com",
  appId: "dispatch",
  scope: "personal",
  enabled: true,
  triggerType: "event",
  event: "issue.created",
  lastStatus: "success",
};

// Real @tanstack/react-query is not exercised here — the route reads its
// list straight from useQuery, so the hook itself is stubbed with a fixed
// two-item list rather than standing up a QueryClient + network mock.
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    if (String(queryKey[0]).includes("automations")) {
      return {
        data: [automationA, automationB],
        isLoading: false,
        isError: false,
        error: null,
      };
    }
    return { data: undefined, isLoading: false, isError: false, error: null };
  },
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  }),
  useQueryClient: () => ({
    cancelQueries: vi.fn(),
    getQueriesData: vi.fn(() => []),
    setQueriesData: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({
    isPending: false,
    mutate: vi.fn(),
    reset: vi.fn(),
    error: null,
  }),
  useChangeVersions: () => 0,
  useActionQuery: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: vi.fn(),
}));

vi.mock("@agent-native/core/client/composer", () => ({
  PromptComposer: () => null,
}));

vi.mock("../../components/dispatch-shell", () => ({
  DispatchShell: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));

vi.mock("../../components/automation-details-panel", () => ({
  AutomationDetailsPanel: ({
    automation,
  }: {
    automation: DispatchAutomationItem;
  }) => <div data-testid="details-panel">{automation.name}</div>,
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{location.pathname + location.search}</div>
  );
}

function GoBackProbe() {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="go-back" onClick={() => navigate(-1)}>
      Back
    </button>
  );
}

describe("AutomationsRoute", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function locationText() {
    return container.querySelector('[data-testid="location"]')?.textContent;
  }

  function findRowButton(name: string) {
    return [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(name),
    );
  }

  it("writes the selected automation into the URL so it survives reload and back navigation", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/automations"]}>
          <AutomationsRoute />
          <LocationProbe />
        </MemoryRouter>,
      );
    });

    expect(locationText()).toBe("/automations");

    const row = findRowButton(automationA.name);
    expect(row).toBeTruthy();

    await act(async () => {
      row?.click();
    });

    expect(
      container.querySelector('[data-testid="details-panel"]')?.textContent,
    ).toBe(automationA.name);
    // Selecting a row must push the identity into the address bar — a plain
    // local-state selection leaves the URL unchanged, which is exactly the
    // bug this test guards against (no way to link/reload/Back to a row).
    expect(locationText()).toBe(
      `/automations?automationId=${encodeURIComponent(automationIdentity(automationA))}`,
    );

    const otherRow = findRowButton(automationB.name);
    await act(async () => {
      otherRow?.click();
    });

    expect(locationText()).toBe(
      `/automations?automationId=${encodeURIComponent(automationIdentity(automationB))}`,
    );
  });

  it("pushes a history entry per row selection so Back steps through prior selections", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/automations"]}>
          <AutomationsRoute />
          <LocationProbe />
          <GoBackProbe />
        </MemoryRouter>,
      );
    });

    const goBack = container.querySelector<HTMLButtonElement>(
      '[data-testid="go-back"]',
    );
    expect(goBack).toBeTruthy();

    await act(async () => {
      findRowButton(automationA.name)?.click();
    });
    expect(locationText()).toBe(
      `/automations?automationId=${encodeURIComponent(automationIdentity(automationA))}`,
    );

    await act(async () => {
      findRowButton(automationB.name)?.click();
    });
    expect(locationText()).toBe(
      `/automations?automationId=${encodeURIComponent(automationIdentity(automationB))}`,
    );

    // A row click is an explicit user selection, not URL canonicalization —
    // it must push a new history entry so Back steps back through the prior
    // selection (A) instead of skipping past the whole page's history in one
    // jump. Replacing on every click (the bug this guards against) collapses
    // all selections into a single entry.
    await act(async () => {
      goBack?.click();
    });
    expect(locationText()).toBe(
      `/automations?automationId=${encodeURIComponent(automationIdentity(automationA))}`,
    );

    await act(async () => {
      goBack?.click();
    });
    expect(locationText()).toBe("/automations");
  });

  it("reopens the matching detail panel when automationId is already in the URL", async () => {
    const targetId = automationIdentity(automationB);
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            `/automations?automationId=${encodeURIComponent(targetId)}`,
          ]}
        >
          <AutomationsRoute />
        </MemoryRouter>,
      );
    });

    expect(
      container.querySelector('[data-testid="details-panel"]')?.textContent,
    ).toBe(automationB.name);
  });
});
