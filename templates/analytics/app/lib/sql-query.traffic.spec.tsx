// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  useSession: () => ({
    session: { email: "a@example.com", userId: "user-a", orgId: "org-1" },
    status: "authenticated",
  }),
}));
vi.mock("./cost-tracker", () => ({
  addBytesProcessed: vi.fn(),
  recordQueryCost: vi.fn(),
}));

import type { TrafficEnvironment } from "@shared/traffic-environment";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TrafficEnvironmentContext, useSqlQuery } from "./sql-query";

function QueryProbe({ source }: { source: "first-party" | "bigquery" }) {
  useSqlQuery(["sql", source], "SELECT 1", source);
  return null;
}

describe("useSqlQuery traffic", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  async function render(
    source: "first-party" | "bigquery",
    environment: TrafficEnvironment | undefined,
  ) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TrafficEnvironmentContext.Provider value={environment}>
            <QueryProbe source={source} />
          </TrafficEnvironmentContext.Provider>
        </QueryClientProvider>,
      );
    });
  }

  const sentEnvironments = () =>
    mocks.callAction.mock.calls.map(([, args]) => args.environment);

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mocks.callAction.mockReset();
    mocks.callAction.mockResolvedValue({ rows: [], schema: [] });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
  });

  it("asks a first-party panel for the dashboard's traffic, and refetches on a switch", async () => {
    await render("first-party", "production");
    expect(sentEnvironments()).toEqual(["production"]);

    await render("first-party", "beta");
    expect(sentEnvironments()).toEqual(["production", "beta"]);
  });

  it("sends nothing for all traffic", async () => {
    await render("first-party", undefined);
    expect(sentEnvironments()).toEqual([undefined]);
  });

  it("never filters a panel on another source", async () => {
    await render("bigquery", "production");
    expect(sentEnvironments()).toEqual([undefined]);
  });
});
