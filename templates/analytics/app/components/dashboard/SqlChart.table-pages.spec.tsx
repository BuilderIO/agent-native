// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({
    session: { email: "viewer@example.com", userId: "viewer", orgId: "org-1" },
    status: "authenticated",
  }),
  useActionMutation: () => ({ mutate: () => {}, isPending: false }),
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));

vi.mock("@agent-native/toolkit/app/extensions", () => ({
  EmbeddedExtension: () => null,
  ExtensionSlot: () => null,
  isExtensionApiPath: () => false,
}));

import { SqlChart } from "./SqlChart";

const TABLE: SqlPanel = {
  id: "p",
  title: "P",
  sql: "SELECT 1",
  source: "first-party",
  chartType: "table",
  width: 1,
  config: { columns: [{ key: "name" }, { key: "count" }] },
};

const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: `Row ${i + 1}`, count: i }));

describe("SqlChart table pages", () => {
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

  async function renderRows(count: number) {
    await act(async () => {
      root.render(
        <SqlChart panel={TABLE} resultOverride={{ rows: rows(count) }} />,
      );
    });
  }

  function bodyNames(): string[] {
    return Array.from(container.querySelectorAll("tbody tr")).map(
      (row) => row.querySelector("td")?.textContent ?? "",
    );
  }

  async function nextPage() {
    const button = container
      .querySelector("svg.tabler-icon-chevron-right")
      ?.closest("button");
    if (!button) throw new Error("next-page button not rendered");
    await act(async () => {
      button.click();
    });
  }

  it("shows the rows that remain when a refresh shrinks the results under the viewer's page", async () => {
    await renderRows(60);
    await nextPage();
    await nextPage();
    expect(bodyNames()[0]).toBe("Row 51");

    await renderRows(20);
    expect(bodyNames()).toHaveLength(20);
    expect(bodyNames()[0]).toBe("Row 1");
  });

  it("moves back from the last page that still has rows", async () => {
    await renderRows(60);
    await nextPage();
    await nextPage();

    await renderRows(40);
    expect(bodyNames()[0]).toBe("Row 26");
    expect(container.textContent).toContain("26–40 of 40");

    const previous = container
      .querySelector("svg.tabler-icon-chevron-left")
      ?.closest("button");
    if (!previous) throw new Error("previous-page button not rendered");
    await act(async () => {
      previous.click();
    });
    expect(bodyNames()[0]).toBe("Row 1");
  });
});
