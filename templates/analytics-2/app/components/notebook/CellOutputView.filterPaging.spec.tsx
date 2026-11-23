// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import enUS from "@/i18n/en-US";

import { CellOutputView } from "./CellOutputView";

/**
 * Census CEN-analytics-2-027: on page 2 of a 100-row result, filtering the table
 * down to a single matching row showed an EMPTY body - the view sliced the
 * single match at the page-2 offset - while the pager and the count still
 * described the unfiltered result.
 *
 * This is the batch's acceptance shape: two full pages of materialised rows, page
 * 2 reached with the pager, then one filter. No manual page navigation after the
 * filter.
 */
const rows = Array.from({ length: 100 }, (_, index) => [
  index === 73 ? "unique-match" : `region-${index}`,
  String(index),
]);

const output = {
  type: "table" as const,
  columns: [{ name: "region" }, { name: "orders" }],
  rows,
  rowCount: 100,
};

/** The fixture as the view's props; typed loosely, the way the sibling spec does. */
function pageProps(): Record<string, unknown> {
  return {
    output,
    rowCount: 100,
    totalRows: "100",
    hasNextPage: false,
  } as unknown as Record<string, unknown>;
}

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const View = CellOutputView as unknown as (
    props: Record<string, unknown>,
  ) => React.ReactElement;
  act(() =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <View {...pageProps()} />
      </AgentNativeI18nProvider>,
    ),
  );
  return { container, root };
}

const click = (element: Element | null | undefined) => {
  act(() => element?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

function bodyText(container: HTMLElement): string[] {
  return [...container.querySelectorAll("tbody tr td:first-of-type")].map(
    (cell) => cell.textContent ?? "",
  );
}

function setFilterToUniqueMatch(container: HTMLElement) {
  act(() =>
    container
      .querySelector('button[aria-label="Column actions for region"]')
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
  const filterItem = [...document.querySelectorAll('[role="menuitem"]')].find(
    (item) => /filter/i.test(item.textContent ?? ""),
  );
  click(filterItem);
  const input = container.querySelector<HTMLInputElement>(
    'input[placeholder*="Filter"], input[aria-label*="Filter"]',
  );
  expect(input, "the filter input").not.toBeNull();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, "unique-match");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("shows the single matching row when filtering from page 2", () => {
  const { container } = render();

  // reach page 2 with the pager, and confirm it is the page being shown
  click(container.querySelector('button[aria-label="Next page"]'));
  expect(bodyText(container)[0]).toBe("region-50");

  setFilterToUniqueMatch(container);

  // the match is visible without navigating back
  const visible = bodyText(container);
  expect(visible).toEqual(["unique-match"]);

  // the pager cannot offer a second page of a one-row view
  const next = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Next page"]',
  );
  expect(next?.disabled).toBe(true);

  // the counts separate the shown match from the unfiltered total
  const counts = container.textContent ?? "";
  expect(counts).toMatch(/1 shown of/i);
  expect(counts).toMatch(/unfiltered/i);
});
