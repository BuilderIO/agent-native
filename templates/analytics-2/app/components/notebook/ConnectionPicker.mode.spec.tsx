// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ConnectionPicker } from "./ConnectionPicker";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it("report A2-DATAFRAME-LABEL-MODE: selects dataframes from an implicit connection", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const select = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ConnectionPicker
          connections={[]}
          value={undefined}
          onSelect={select}
        />,
      ),
    );
    const trigger = host.querySelector("button");
    expect(trigger?.getAttribute("aria-label")).toBe(
      "Data connection: Select a source",
    );
    await act(async () => trigger?.click());
    const option = document.querySelector<HTMLButtonElement>(
      '[role="menuitemradio"]',
    );
    expect(option?.getAttribute("aria-checked")).toBe("false");
    await act(async () => option?.click());
    expect(select).toHaveBeenCalledWith(null);
    await act(async () =>
      root.render(
        <ConnectionPicker connections={[]} value={null} onSelect={select} />,
      ),
    );
    expect(trigger?.getAttribute("aria-label")).toBe(
      "Data connection: Dataframes",
    );
    expect(trigger?.querySelector("svg")).toBeNull();
    expect(trigger?.querySelector(".nb-connection-chevron")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("shows chevron only when no source is selected and omits icon for Dataframes", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <ConnectionPicker
          connections={[{ id: "wh", name: "BigQuery", type: "bigquery" }]}
          value={undefined}
          onSelect={() => {}}
        />,
      ),
    );
    expect(host.querySelector(".nb-connection-chevron")).not.toBeNull();

    await act(async () =>
      root.render(
        <ConnectionPicker
          connections={[{ id: "wh", name: "BigQuery", type: "bigquery" }]}
          value="wh"
          onSelect={() => {}}
        />,
      ),
    );
    expect(host.querySelector(".nb-connection-chevron")).toBeNull();
    expect(host.querySelector("button svg")).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("report A2-CONNECTION-READ-STATE: distinguishes loading, failure, and a missing source", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    const render = async (
      loading: boolean,
      error: string | null,
      connections: { id: string; name: string }[],
    ) => {
      await act(async () =>
        root.render(
          <ConnectionPicker
            connections={connections}
            value="warehouse"
            loading={loading}
            error={error}
            onSelect={() => {}}
          />,
        ),
      );
    };
    await render(true, null, []);
    expect(host.textContent).not.toContain("Unknown connection");
    expect(host.querySelector("button")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    await render(false, "unavailable", []);
    expect(host.textContent).not.toContain("Unknown connection");
    await render(false, null, [{ id: "warehouse", name: "bigquery builder" }]);
    expect(host.textContent).toContain("bigquery builder");
    await render(false, null, []);
    expect(host.textContent).toContain("Unknown connection");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it.each([
  ["missing", "Unknown connection"],
  ["unavailable", "Load error"],
] as const)(
  "report A2-DEFAULT-SOURCE: shows selected source %s while the catalog is loading",
  async (selectionStatus, expected) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <ConnectionPicker
            connections={[]}
            value="warehouse"
            loading
            selectionStatus={selectionStatus}
            onSelect={() => {}}
          />,
        ),
      );
      expect(host.textContent).toContain(expected);
      expect(
        host.querySelector("button")?.getAttribute("aria-busy"),
      ).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);
