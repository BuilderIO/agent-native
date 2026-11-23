// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import { cellOutputSchema } from "@/lib/model/contracts";

import { CellOutputView } from "./CellOutputView";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("marks null values with nb-result-null while leaving literal 'null' strings unmarked", () => {
  act(() =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <CellOutputView
          output={cellOutputSchema.parse({
            type: "table",
            columns: [
              { name: "label", type: "string" },
              { name: "amount", type: "number" },
            ],
            rows: [
              [null, null],
              ["null", 42],
            ],
            rowCount: 2,
            truncated: false,
          })}
        />
      </AgentNativeI18nProvider>,
    ),
  );

  const cells = [...container.querySelectorAll("tbody td")];
  expect(cells).toHaveLength(4);
  expect(cells[0]?.textContent).toBe("null");
  expect(cells[0]?.classList.contains("nb-result-null")).toBe(true);
  expect(cells[1]?.textContent).toBe("null");
  expect(cells[1]?.classList.contains("nb-result-null")).toBe(true);
  expect(cells[1]?.classList.contains("nb-result-number")).toBe(true);
  expect(cells[2]?.textContent).toBe("null");
  expect(cells[2]?.classList.contains("nb-result-null")).toBe(false);
  expect(cells[3]?.textContent).toBe("42");
  expect(cells[3]?.classList.contains("nb-result-null")).toBe(false);
});
