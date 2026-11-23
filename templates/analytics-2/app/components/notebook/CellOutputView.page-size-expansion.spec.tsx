// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { CellOutputView } from "./CellOutputView";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const TOTAL = 150;
const ids = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

type Load = {
  required: number;
  resolve: () => void;
  reject: (error: Error) => void;
};

let container: HTMLDivElement;
let root: Root;
let loads: Load[];
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  loads = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  consoleError.mockRestore();
});

function Result({
  knownTotal,
  auto,
  loading = false,
}: {
  knownTotal: boolean;
  auto: boolean;
  loading?: boolean;
}) {
  const [count, setCount] = useState(50);
  return (
    <CellOutputView
      loading={loading}
      output={{
        type: "table",
        columns: [{ name: "value", type: "string" }],
        rows: ids(1, count).map((id) => [id]),
        rowCount: count,
        truncated: count < TOTAL,
      }}
      hasNextPage={count < TOTAL}
      totalRows={knownTotal ? String(TOTAL) : undefined}
      onLoadRows={(required) => {
        const next = Math.min(required, TOTAL);
        if (auto) {
          setCount(next);
          return Promise.resolve(next);
        }
        return new Promise<number>((resolve, reject) => {
          loads.push({
            required,
            resolve: () => {
              setCount(next);
              resolve(next);
            },
            reject,
          });
        });
      }}
    />
  );
}

const mount = (props: {
  knownTotal?: boolean;
  auto?: boolean;
  loading?: boolean;
}) =>
  act(async () =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <Result
          knownTotal={props.knownTotal ?? true}
          auto={props.auto ?? true}
          loading={props.loading ?? false}
        />
      </AgentNativeI18nProvider>,
    ),
  );
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const rows = () =>
  [...container.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent).join(""),
  );
const alertText = () => container.querySelector('[role="alert"]')?.textContent;
const choosePageSize = async (label: string) => {
  await act(async () =>
    button("Rows per page")?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === label)
      ?.click(),
  );
};
const next = () => act(async () => button("Next page")?.click());

it.each([
  { name: "known total", knownTotal: true },
  { name: "unknown total", knownTotal: false },
])(
  "report B-RESULT-PAGESIZE-GAP: a larger page size shows every row in order with $name",
  async ({ knownTotal }) => {
    await mount({ knownTotal });
    expect(rows()).toEqual(ids(1, 50));
    await choosePageSize("100 rows");
    const seen = rows();
    expect(seen).toEqual(ids(1, 100));
    expect(container.textContent).toContain("Rows 1–100 of");
    await next();
    seen.push(...rows());
    expect(rows()).toEqual(ids(101, 150));
    expect(seen).toEqual(ids(1, 150));
    expect(button("Next page")?.disabled).toBe(true);
  },
);

it("report B-RESULT-PAGESIZE-GAP: the first page acknowledges loading until the larger page arrives", async () => {
  await mount({ auto: false });
  await choosePageSize("100 rows");
  expect(loads.map((load) => load.required)).toEqual([100]);
  expect(container.querySelector(".skeleton-shimmer")).not.toBeNull();
  expect(container.querySelector(".nb-output")?.getAttribute("aria-busy")).toBe(
    "true",
  );
  expect(button("Next page")?.disabled).toBe(true);
  expect(rows()).toEqual(ids(1, 50));
  await act(async () => loads[0]?.resolve());
  expect(container.textContent).not.toContain("Loading…");
  expect(rows()).toEqual(ids(1, 100));
  await next();
  expect(loads.map((load) => load.required)).toEqual([100, 150]);
  await act(async () => loads[1]?.resolve());
  expect(rows()).toEqual(ids(101, 150));
});

it("report B-RESULT-PAGESIZE-GAP: a failed larger page shows the failure and Retry fills the first page", async () => {
  await mount({ auto: false });
  await choosePageSize("100 rows");
  await act(async () => loads[0]?.reject(new Error("Provider unavailable")));
  expect(alertText()).toContain("Provider unavailable");
  expect(rows()).toEqual(ids(1, 50));
  expect(container.textContent).toContain("Rows 1–50 of");
  const retry = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="alert"] button'),
  ].find((item) => item.textContent === "Retry");
  await act(async () => retry?.click());
  expect(loads.map((load) => load.required)).toEqual([100, 100]);
  await act(async () => loads[1]?.resolve());
  expect(alertText()).toBeUndefined();
  expect(rows()).toEqual(ids(1, 100));
  expect(container.textContent).toContain("Rows 1–100 of");
});

const settle = (load: Load | undefined, outcome: "failure" | "success") =>
  act(async () =>
    outcome === "failure"
      ? load?.reject(new Error("Stale failure"))
      : load?.resolve(),
  );

it("report B-RESULT-PAGESIZE-GAP: an old Next load failure is ignored after a larger size is chosen", async () => {
  await mount({ auto: false });
  await next();
  await choosePageSize("100 rows");
  // oracle-change: the cell is busy until the old load settles, so the latest load starts afterward
  expect(loads.map((load) => load.required)).toEqual([100]);
  await settle(loads[0], "failure");
  expect(loads.map((load) => load.required)).toEqual([100, 100]);
  expect(alertText()).toBeUndefined();
  expect(container.querySelector(".skeleton-shimmer")).not.toBeNull();
  expect(rows()).toEqual(ids(1, 50));
  await act(async () => loads[1]?.resolve());
  expect(rows()).toEqual(ids(1, 100));
  expect(container.textContent).toContain("Rows 1–100 of");
  expect(alertText()).toBeUndefined();
});

it("report B-RESULT-PAGESIZE-GAP: an old Next load that succeeds first keeps the reader on the first page", async () => {
  await mount({ auto: false });
  await next();
  await choosePageSize("100 rows");
  // oracle-change: the cell is busy until the old load settles, so no redundant second load is requested
  expect(loads.map((load) => load.required)).toEqual([100]);
  await settle(loads[0], "success");
  expect(loads.map((load) => load.required)).toEqual([100]);
  expect(alertText()).toBeUndefined();
  expect(rows()).toEqual(ids(1, 100));
  expect(container.textContent).toContain("Rows 1–100 of");
  expect(container.textContent).not.toContain("Loading…");
  expect(button("Previous page")?.disabled).toBe(true);
});

it.each(["failure", "success"] as const)(
  "report B-RESULT-PAGESIZE-GAP: an old Next load %s does not advance the page after a smaller size is chosen",
  async (outcome) => {
    await mount({ auto: false });
    await next();
    await choosePageSize("25 rows");
    expect(rows()).toEqual(ids(1, 25));
    await settle(loads[0], outcome);
    expect(alertText()).toBeUndefined();
    expect(rows()).toEqual(ids(1, 25));
    expect(container.textContent).toContain("Rows 1–25 of");
    expect(button("Previous page")?.disabled).toBe(true);
  },
);

it.each(["failure", "success"] as const)(
  "report B-RESULT-PAGESIZE-GAP: a superseded larger page load %s is ignored after a later size choice",
  async (outcome) => {
    await mount({ auto: false });
    await choosePageSize("100 rows");
    await choosePageSize("25 rows");
    expect(loads.map((load) => load.required)).toEqual([100]);
    await settle(loads[0], outcome);
    expect(alertText()).toBeUndefined();
    expect(container.textContent).not.toContain("Loading…");
    expect(rows()).toEqual(ids(1, 25));
    expect(container.textContent).toContain("Rows 1–25 of");
  },
);

it("report B-RESULT-PAGESIZE-GAP: a rerun releases the pending larger page", async () => {
  await mount({ auto: false });
  await choosePageSize("100 rows");
  expect(loads.map((load) => load.required)).toEqual([100]);
  await mount({ auto: false, loading: true });
  await mount({ auto: false, loading: false });
  await act(async () => loads[0]?.reject(new Error("Stale failure")));
  expect(alertText()).toBeUndefined();
  expect(container.textContent).not.toContain("Loading…");
  expect(rows()).toEqual(ids(1, 50));
});

it("report B-RESULT-PAGESIZE-GAP: an unmounted result ignores its pending larger page", async () => {
  await mount({ auto: false });
  await choosePageSize("100 rows");
  expect(loads.map((load) => load.required)).toEqual([100]);
  await act(async () => root.unmount());
  await act(async () => loads[0]?.reject(new Error("Late failure")));
  expect(consoleError).not.toHaveBeenCalled();
  root = createRoot(container);
});

it("report B-RESULT-PAGESIZE-GAP: a larger page that returns no new rows releases the pager", async () => {
  const load = vi.fn().mockResolvedValue(50);
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <CellOutputView
          output={{
            type: "table",
            columns: [{ name: "value", type: "string" }],
            rows: ids(1, 50).map((id) => [id]),
            rowCount: 50,
            truncated: true,
          }}
          hasNextPage
          onLoadRows={load}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  await choosePageSize("100 rows");
  expect(load).toHaveBeenCalledWith(100);
  expect(alertText()).toContain("More rows are not available.");
  expect(container.textContent).not.toContain("Loading…");
  expect(rows()).toEqual(ids(1, 50));
});
