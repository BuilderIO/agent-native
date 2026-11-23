// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("./VegaChart", () => ({ VegaChart: () => null }));

import enUS from "@/i18n/en-US";

import { CellOutputView } from "./CellOutputView";

it("bug 554: a table result offers an Add chart cell control", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onAddChartCell = vi.fn();
  const render = async (handler: (() => void) | undefined) =>
    act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <CellOutputView
            output={{
              type: "table",
              columns: [{ name: "name", type: "string" }],
              rows: [["Ada"]],
              rowCount: 1,
              truncated: false,
            }}
            onAddChartCell={handler}
          />
        </AgentNativeI18nProvider>,
      ),
    );
  const button = () =>
    Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Add chart cell",
    );

  await render(undefined);
  expect(button()).toBeUndefined();

  await render(onAddChartCell);
  await act(async () => button()?.click());
  expect(onAddChartCell).toHaveBeenCalledTimes(1);

  await act(async () => root.unmount());
  container.remove();
});
