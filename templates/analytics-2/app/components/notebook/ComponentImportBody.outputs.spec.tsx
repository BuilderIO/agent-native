// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: {
      cells: [
        {
          id: "1",
          kind: "sql",
          label: "Text result",
          contents: {},
          output: { type: "text", text: "Hello from the component" },
        },
        {
          id: "2",
          kind: "sql",
          label: "Metric",
          contents: {},
          output: { type: "metric", value: 42, formatted: "42 units" },
        },
        {
          id: "4",
          kind: "sql",
          label: "Table",
          contents: {},
          output: {
            type: "table",
            columns: [{ name: "amount", type: "number" }],
            rows: Array.from({ length: 51 }, (_, index) => [index]),
            rowCount: 100,
            truncated: true,
          },
        },
        {
          id: "3",
          kind: "sql",
          label: "Error",
          contents: {},
          output: { type: "error", message: "Query failed", detail: null },
        },
      ],
    },
    isPending: false,
    error: null,
  }),
}));
const { ComponentImportBody } = await import("./ComponentImportBody");

it("report A2-COMPONENT-SNAPSHOT-OUTPUTS: renders captured text, metric, and error results", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <ComponentImportBody componentId="k" title="K" />
        </AgentNativeI18nProvider>,
      ),
    );
    expect(mount.textContent).toContain("Hello from the component");
    expect(mount.textContent).toContain("42 units");
    expect(mount.textContent).toContain("Query failed");
    expect(mount.textContent).toContain("Showing the first 51 rows.");
    expect(mount.textContent).toContain("51+ rows");
    expect(mount.textContent).not.toContain("This cell captured no result.");
  } finally {
    await act(async () => root.unmount());
    mount.remove();
  }
});
