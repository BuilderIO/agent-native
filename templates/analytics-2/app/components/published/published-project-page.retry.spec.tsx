// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";
import { projectDocumentSchema } from "@/lib/model/contracts";
import { resolveRoute } from "@/routes/routing/registry";

const mocks = vi.hoisted(() => ({
  viewerError: null as Error | null,
  viewerRetry: vi.fn(),
  orgIsError: false,
  orgRefetch: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => {
    const value = key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined,
        messages,
      );
    return typeof value === "string" ? value : key;
  },
  useFormatters: () => ({
    formatNumber: (value: number) => String(value),
    formatDate: (value: Date | number | string) =>
      new Date(value).toISOString(),
  }),
  useReaderLocale: () => "en-US",
  useOptionalLocale: () => ({ dir: "ltr" }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, useQueries: () => [] };
});

vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatHome: () => null,
  AgentChatSurface: () => null,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({
    data: undefined,
    isPending: false,
    isError: mocks.orgIsError,
    refetch: mocks.orgRefetch,
  }),
}));

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    status: "authenticated",
    session: { email: "reader@example.invalid" },
  }),
}));

vi.mock("@/components/sharing/PublishedAppSharePopover", () => ({
  PublishedAppSharePopover: () => <button type="button">Share</button>,
}));

vi.mock("./PublishedAppSchedulePanel", () => ({
  PublishedAppSchedulePanel: () => null,
}));

const timestamp = "2026-11-15T00:00:00.000Z";
const parsedProject = projectDocumentSchema.parse({
  id: "prj_1",
  ownerEmail: "reader@example.invalid",
  title: "Revenue overview",
  description: "",
  language: "python",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  workingVersionId: "ver_working",
  publishedVersionId: "ver_published",
  collectionIds: [],
  cells: [],
});

vi.mock("./usePublishedAppSession", () => ({
  usePublishedAppSession: () => ({
    session: {
      releaseId: "rel_1",
      sessionId: "sess_1",
      state: "ready",
      refreshedAt: timestamp,
      staleAfter: { kind: "hours", value: 24 },
      refreshUnavailable: false,
      overrides: {},
      outputs: {},
      queryStates: {},
      caps: { refreshDefault: true, saveView: true },
      projection: {
        project: parsedProject,
        outputs: {},
        queryStates: {},
      },
    },
    busy: false,
    loading: false,
    accessDenied: false,
    error: mocks.viewerError,
    refresh: vi.fn(),
    retry: mocks.viewerRetry,
    reset: vi.fn(),
    changeInput: vi.fn(),
    commitInput: vi.fn(),
    commitInputs: vi.fn(),
    values: {},
    saveView: vi.fn(async () => ({})),
  }),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    ...actual,
    useActionQuery: (name: string) =>
      name === "get-published-project"
        ? {
            data: { project: parsedProject, outputs: {}, queryStates: {} },
            isPending: false,
            isError: false,
            error: null,
            refetch: vi.fn(),
          }
        : { data: undefined, isPending: false, isError: false },
    callAction: vi.fn(),
  };
});

import { PublishedProjectPage } from "./PublishedProjectPage";

describe("PublishedProjectPage retry actions", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.viewerError = null;
    mocks.viewerRetry.mockClear();
    mocks.orgIsError = false;
    mocks.orgRefetch.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const renderPage = () =>
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={["/app/prj_1/latest"]}>
            <PublishedProjectPage route={resolveRoute("/app/prj_1/latest")} />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

  it("offers a retry button on the mounted session error alert", async () => {
    mocks.viewerError = new Error("Session refresh failed");
    renderPage();
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("An unexpected error occurred.");
    const retry = [...(alert?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Retry",
    );
    expect(retry).toBeDefined();
    await act(async () => {
      retry?.click();
    });
    expect(mocks.viewerRetry).toHaveBeenCalledOnce();
  });

  it("offers a retry button when the published agent panel org query fails", async () => {
    mocks.orgIsError = true;
    renderPage();
    const agentButton = [
      ...host.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) =>
      button.getAttribute("aria-label")?.toLowerCase().includes("agent"),
    );
    expect(agentButton).toBeDefined();
    await act(async () => {
      agentButton?.click();
    });
    const alerts = [...document.body.querySelectorAll('[role="alert"]')];
    const orgAlert = alerts.find((el) =>
      el.textContent?.includes("An unexpected error occurred."),
    );
    expect(orgAlert).toBeDefined();
    const retry = [...(orgAlert?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Retry",
    );
    expect(retry).toBeDefined();
    await act(async () => {
      retry?.click();
    });
    expect(mocks.orgRefetch).toHaveBeenCalledOnce();
  });
});
