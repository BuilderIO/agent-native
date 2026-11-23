// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { DataResourceDetail } from "./DataResourceDetail";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function mountEmpty(type: "database" | "schema") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <DataResourceDetail
        connectionId="c1"
        connectionName="Warehouse"
        node={{ type, id: "n1", name: "n1" }}
        loadPage={async () => ({
          items: [],
          endCursor: null,
          hasNextPage: false,
          totalCount: 0,
        })}
        onNavigate={() => {}}
        tab="all"
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { container, root };
}

describe("DataResourceDetail zero-row state", () => {
  it.each([
    ["database", "SCHEMAS (0)", "No schemas found"],
    ["schema", "TABLES (0)", "No tables found"],
  ] as const)(
    "keeps the %s grid header with an empty-row message",
    async (type, header, message) => {
      const { container, root } = await mountEmpty(type);
      expect(container.querySelector("table thead th")?.textContent).toBe(
        header,
      );
      expect(container.querySelector("tbody td")?.textContent).toBe(message);
      await act(async () => root.unmount());
      container.remove();
    },
  );
});
