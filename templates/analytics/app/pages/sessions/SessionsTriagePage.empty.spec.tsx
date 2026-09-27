// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  error: null as Error | null,
  refetch: vi.fn(),
  useActionQuery: vi.fn(() => ({
    data: { recordings: [], total: 0, appCounts: [] },
    error: mocks.error,
    isLoading: false,
    isFetching: false,
    refetch: mocks.refetch,
  })),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: mocks.useActionQuery,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/blocks", () => ({
  CodeSurface: () => <div data-testid="installation-snippet" />,
}));
vi.mock("@agent-native/core/client/settings", () => ({
  BuilderConnectPopover: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useBuilderConnectFlow: () => ({
    configured: false,
    connecting: false,
    hasFetchedStatus: true,
  }),
  useBuilderStatus: () => ({
    status: { configured: false },
    loading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-replay-storage-status", () => ({
  useReplayStorageStatus: () => ({
    data: { configured: mocks.configured },
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

import { SessionsTriagePage } from "./SessionsTriagePage";

describe("Sessions empty states", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.error = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows a filtered-empty state for configured storage without setup guidance", async () => {
    mocks.configured = true;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions?q=no-matching-session"]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("sessions.noSessions");
    expect(container.textContent).not.toContain("sessions.storageSetupTitle");
    expect(container.textContent).not.toContain("sessions.installSnippetTitle");
    expect(
      container.querySelector('[data-testid="installation-snippet"]'),
    ).toBeNull();
  });

  it("keeps storage connection, installation, and docs paths for a new install", async () => {
    mocks.configured = false;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions"]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("sessions.storageSetupTitle");
    expect(container.textContent).toContain("sessions.connectBuilder");
    expect(container.textContent).toContain("sessions.configureS3");
    expect(container.textContent).toContain("sessions.installSnippetTitle");
    expect(
      container.querySelector('[data-testid="installation-snippet"]'),
    ).not.toBeNull();
    expect(container.querySelector('a[href*="session-replay"]')).not.toBeNull();
  });

  it("shows a list error and retries without replacing it with setup guidance", async () => {
    mocks.configured = false;
    mocks.error = new Error("Session list unavailable");
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions"]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "sessions.loadFailed",
    );
    expect(container.textContent).not.toContain("sessions.storageSetupTitle");
    expect(container.textContent).not.toContain("sessions.installSnippetTitle");
    await act(async () => {
      container
        .querySelector('button[aria-label="sessions.refresh"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
