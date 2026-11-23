// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import enUS from "@/i18n/en-US";

import { CellOutputView } from "./CellOutputView";

function render(totalRows: string) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const rows = Array.from({ length: 50 }, (_, index) => [index + 1]);
  act(() =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <CellOutputView
          queryTableControls
          artifactPage={1}
          queryRequestId="pager-total"
          output={{
            type: "table",
            columns: [{ name: "n", type: "number" }],
            rows,
            rowCount: 50,
            truncated: true,
            totalRows,
          }}
          hasNextPage
          onLoadPage={async () => rows}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  return { container, root };
}

it("shows the exact total in the pager when it is known", () => {
  const { container, root } = render("60");
  expect(container.textContent).toContain("Rows 1–50 of 60");
  expect(container.textContent).not.toContain("of 60+");
  act(() => root.unmount());
});
