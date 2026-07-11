// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: {
    data: {
      rows: [{ value: 42 }],
    },
    isLoading: false,
    isFetching: false,
    error: null,
  },
}));

vi.mock("@agent-native/core/client", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: () => mocks.query,
}));

import { SqlChart } from "./SqlChart";

describe("SqlChart refresh feedback", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.query.isLoading = false;
    mocks.query.isFetching = false;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("restores the panel skeleton while cached data is refetching", async () => {
    const panel = {
      id: "signups",
      title: "Signups",
      sql: "SELECT 42 AS value",
      source: "first-party" as const,
      chartType: "metric" as const,
      width: 1,
    };

    await act(async () => {
      root.render(<SqlChart panel={panel} />);
    });

    expect(container.textContent).toContain("42");
    expect(
      container.querySelector('[data-dashboard-report-loading="true"]'),
    ).toBeNull();

    mocks.query.isFetching = true;
    await act(async () => {
      root.render(<SqlChart panel={panel} />);
    });

    expect(
      container.querySelector('[data-dashboard-report-loading="true"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("42");

    mocks.query.isFetching = false;
    await act(async () => {
      root.render(<SqlChart panel={panel} />);
    });

    expect(
      container.querySelector('[data-dashboard-report-loading="true"]'),
    ).toBeNull();
    expect(container.textContent).toContain("42");
  });
});
