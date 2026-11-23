// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { CellOutputView } from "./CellOutputView";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

const BUSY_MESSAGE =
  "The query changed or another request is still running. Reload this project before continuing.";

const allRows = Array.from({ length: 300 }, (_, i) => [
  i === 0 || i === 120 ? `match-${i}` : `other-${i}`,
]);

type PendingLoad = { resolve: () => void; reject: (error: Error) => void };

async function mountView({ failSecondLoad = false } = {}) {
  const requested: number[] = [];
  const pending: PendingLoad[] = [];
  let busy = false;
  let overlappingCalls = 0;
  function View({ loading = false }: { loading?: boolean }) {
    const [count, setCount] = useState(50);
    return (
      <CellOutputView
        loading={loading}
        output={{
          type: "table",
          columns: [{ name: "value", type: "string" }],
          rows: allRows.slice(0, count),
          rowCount: count,
          truncated: count < allRows.length,
        }}
        hasNextPage={count < allRows.length}
        onLoadRows={(required) => {
          requested.push(required);
          if (busy) {
            overlappingCalls++;
            return Promise.reject(new Error(BUSY_MESSAGE));
          }
          if (failSecondLoad && requested.length === 2)
            return Promise.reject(new Error("Provider unavailable"));
          busy = true;
          return new Promise<number>((resolve, reject) => {
            pending.push({
              resolve: () => {
                busy = false;
                const next = Math.min(required, allRows.length);
                setCount(next);
                resolve(next);
              },
              reject: (error) => {
                busy = false;
                reject(error);
              },
            });
          });
        }}
      />
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (loading: boolean) =>
    act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <View loading={loading} />
        </AgentNativeI18nProvider>,
      ),
    );
  await render(false);
  let mounted = true;
  return {
    container,
    requested,
    render,
    overlappingCalls: () => overlappingCalls,
    alert: () => container.querySelector('[role="alert"]')?.textContent ?? "",
    // oracle-change: each row leads with a row-number th; compare its data cells only
    rows: () =>
      [...container.querySelectorAll("tbody tr")].map((row) =>
        [...row.querySelectorAll("td")]
          .map((cell) => cell.textContent)
          .join(""),
      ),
    settleOldest: (outcome: "success" | Error) =>
      act(async () => {
        const load = pending.shift();
        if (outcome === "success") load?.resolve();
        else load?.reject(outcome);
      }),
    drain: async () => {
      for (let i = 0; i < 6 && pending.length; i++)
        await act(async () => pending.shift()?.resolve());
    },
    unmount: async () => {
      if (!mounted) return;
      mounted = false;
      await act(async () => root.unmount());
    },
    dispose: async () => {
      if (mounted) await act(async () => root.unmount());
      container.remove();
    },
  };
}

async function openFilterInput(container: HTMLElement) {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Column actions for value"]',
      )
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent === "Filter...")
      ?.click(),
  );
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Filter value"]',
  );
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

const typeFilter = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

const clickNext = (container: HTMLElement) =>
  act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Next page"]')
      ?.click(),
  );

const otherRows = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `other-${from + i}`);

it.each([
  {
    from: "filtered",
    first: "match" as string | null,
    old: "success" as "success" | Error,
    requested: [100, 150],
  },
  {
    from: "unfiltered",
    first: null,
    old: "success" as "success" | Error,
    requested: [100, 150],
  },
  {
    from: "filtered",
    first: "match",
    old: new Error("Old failure"),
    requested: [100, 100, 150],
  },
  {
    from: "unfiltered",
    first: null,
    old: new Error("Old failure"),
    requested: [100, 100, 150],
  },
])(
  "B-RESULT-FILTER-LOAD-OVERLAP: changing the filter from $from while a page load is pending waits for it ($old)",
  async ({ first, old, requested }) => {
    const view = await mountView();
    try {
      const input = await openFilterInput(view.container);
      if (first) await typeFilter(input, first);
      await clickNext(view.container);
      expect(view.requested).toEqual([100]);

      await typeFilter(input, "other");
      await clickNext(view.container);
      expect(view.requested).toEqual([100]);
      expect(view.overlappingCalls()).toBe(0);
      expect(view.alert()).toBe("");

      await view.settleOldest(old);
      await view.drain();

      expect(view.requested).toEqual(requested);
      expect(view.overlappingCalls()).toBe(0);
      expect(view.alert()).toBe("");
      expect(view.rows()).toEqual(otherRows(51, 100));
    } finally {
      await view.dispose();
    }
  },
);

it("B-RESULT-FILTER-LOAD-OVERLAP: the new filter's genuine failure is shown once the old load settles, not the old failure", async () => {
  const view = await mountView({ failSecondLoad: true });
  try {
    const input = await openFilterInput(view.container);
    await typeFilter(input, "match");
    await clickNext(view.container);
    await typeFilter(input, "other");
    await clickNext(view.container);
    expect(view.requested).toEqual([100]);

    await view.settleOldest(new Error("Old failure"));

    expect(view.requested).toEqual([100, 100]);
    expect(view.overlappingCalls()).toBe(0);
    expect(view.alert()).toContain("Provider unavailable");
    expect(view.alert()).not.toContain("Old failure");
    expect(view.alert()).not.toContain("another request is still running");
  } finally {
    await view.dispose();
  }
});

it("B-RESULT-FILTER-LOAD-OVERLAP: a rerun waits for the old page load before requesting its own", async () => {
  const view = await mountView();
  try {
    await clickNext(view.container);
    expect(view.requested).toEqual([100]);
    await view.render(true);
    await view.render(false);
    await clickNext(view.container);
    expect(view.requested).toEqual([100]);
    expect(view.overlappingCalls()).toBe(0);

    await view.settleOldest(new Error("Interrupted"));

    expect(view.requested).toEqual([100, 100]);
    expect(view.overlappingCalls()).toBe(0);
    expect(view.alert()).toBe("");
    await view.drain();
    expect(view.rows()).toEqual(otherRows(50, 99));
  } finally {
    await view.dispose();
  }
});

it("B-RESULT-FILTER-LOAD-OVERLAP: an unmounted view starts no load and reports nothing when the old load settles", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const view = await mountView();
  try {
    const input = await openFilterInput(view.container);
    await typeFilter(input, "match");
    await clickNext(view.container);
    await typeFilter(input, "other");
    await clickNext(view.container);
    expect(view.requested).toEqual([100]);

    await view.unmount();
    await view.settleOldest("success");

    expect(view.requested).toEqual([100]);
    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    consoleError.mockRestore();
    await view.dispose();
  }
});
