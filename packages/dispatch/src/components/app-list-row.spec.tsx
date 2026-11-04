// @vitest-environment happy-dom
// oracle-change(packages/dispatch/src/components/other-apps-section.spec.ts): OtherAppsSection had no importers and was deleted with its spec.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppList, AppListRow } from "./app-list-row";

describe("AppList", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders grid rows as muted shadcn Items and list rows as divided rows", async () => {
    await act(async () =>
      root.render(
        <>
          <AppList layout="grid">
            <AppListRow>grid app</AppListRow>
          </AppList>
          <AppList>
            <AppListRow>list app</AppListRow>
          </AppList>
        </>,
      ),
    );

    const rows = [...container.querySelectorAll("div")].filter((row) =>
      /^(grid|list) app$/.test(row.textContent ?? ""),
    );
    const grid = rows.find(
      (row) => row.textContent === "grid app" && row.dataset.slot,
    );
    const list = rows.filter((row) => row.textContent === "list app").at(-1);
    expect(grid?.dataset.slot).toBe("item");
    expect(grid?.dataset.variant).toBe("muted");
    // Tabbing into a row marks it; Item only styles its own focus.
    expect(grid?.className).toContain("focus-within:border-ring/50");
    expect(list?.dataset.slot).toBeUndefined();
    expect(list?.className).toContain("border-b");
  });
});
