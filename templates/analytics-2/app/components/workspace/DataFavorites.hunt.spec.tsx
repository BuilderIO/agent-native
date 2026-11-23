// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import type { DatasetLoader } from "@/components/data/model";

import { DataResourceDetail } from "./DataResourceDetail";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("DataResourceDetail load-more failure", () => {
  it("keeps loaded rows and lets Load more retry after a failed page", async () => {
    let calls = 0;
    const loadPage: DatasetLoader = async (input) => {
      calls += 1;
      if (calls === 1) {
        return {
          items: [{ id: "s1", name: "alpha", kind: "schema" }],
          endCursor: "c1",
          hasNextPage: true,
          totalCount: 2,
        };
      }
      if (calls === 2) throw new Error("boom");
      expect(input.after).toBe("c1");
      return {
        items: [{ id: "s2", name: "beta", kind: "schema" }],
        endCursor: null,
        hasNextPage: false,
        totalCount: 2,
      };
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <DataResourceDetail
          connectionId="c1"
          connectionName="Warehouse"
          node={{ type: "database", id: "db1", name: "db1" }}
          loadPage={loadPage}
          onNavigate={() => {}}
          tab="all"
        />,
      );
      await flush();
    });
    const loadMore = () =>
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.startsWith("Load more"),
      );
    await act(async () => {
      loadMore()?.click();
      await flush();
    });

    expect(container.textContent).toContain("alpha");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(loadMore()).toBeDefined();

    await act(async () => {
      loadMore()?.click();
      await flush();
    });

    expect(calls).toBe(3);
    expect(container.textContent).toContain("alpha");
    expect(container.textContent).toContain("beta");
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });
});
