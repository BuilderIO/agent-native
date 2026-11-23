// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { Cell } from "@/lib/model/contracts";

import { ProjectGraphView } from "./ProjectGraphView";
import { ProjectHeader } from "./ProjectHeader";
import { ProjectRunStatsView } from "./ProjectRunStatsView";
import { ProjectSourceView } from "./ProjectSourceView";

const base = {
  title: "Weekly revenue",
  canRename: false,
  onRename: async () => {},
};

function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <MemoryRouter>{node}</MemoryRouter>
      </AgentNativeI18nProvider>,
    ),
  );
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

it("report QA-1795110018.875309 offers Source, Graph mode and Run status from the More project view options menu", () => {
  const onSelectView = vi.fn();
  const { container, unmount } = mount(
    <ProjectHeader
      {...base}
      views={["notebook", "source", "graph", "run-stats"]}
      onSelectView={onSelectView}
    />,
  );
  try {
    const trigger = container.querySelector<HTMLElement>(
      '[aria-label="More project view options"]',
    );
    expect(trigger).not.toBeNull();
    act(() => {
      trigger?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    const items = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    expect(items.map((item) => item.textContent.trim())).toEqual([
      "Source",
      "Graph mode",
      "Run status",
    ]);
    act(() => {
      items[2]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      items[2]?.click();
    });
    expect(onSelectView).toHaveBeenCalledWith("run-stats");
  } finally {
    unmount();
  }
});

it("report QA-1795110018.875309 renders no More menu when the views are not offered", () => {
  const { container, unmount } = mount(
    <ProjectHeader {...base} views={["notebook"]} onSelectView={() => {}} />,
  );
  try {
    expect(
      container.querySelector('[aria-label="More project view options"]'),
    ).toBeNull();
  } finally {
    unmount();
  }
});

const cells = [
  {
    id: "c1",
    contents: { kind: "sql", source: "select 1", order: "a" },
  },
  {
    id: "c2",
    contents: { kind: "markdown", markdown: "# Notes", order: "b" },
  },
] as unknown as Cell[];
const titles = new Map([
  ["c1", "Revenue query"],
  ["c2", "Notes"],
]);

it("report QA-1795110018.875309 lists each cell's source with its name and type", () => {
  const { container, unmount } = mount(
    <ProjectSourceView cells={cells} titles={titles} />,
  );
  try {
    const text = container.textContent;
    expect(text).toContain("Revenue query");
    expect(text).toContain("select 1");
    expect(text).toContain("Notes");
    expect(text).toContain("# Notes");
  } finally {
    unmount();
  }
});

it("report QA-1795110018.875309 shows last-run status and duration per runnable cell", () => {
  const { container, unmount } = mount(
    <ProjectRunStatsView
      cells={cells}
      titles={titles}
      outputs={{ c1: { status: "complete", durationMs: 1500 } }}
    />,
  );
  try {
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("Revenue query");
    expect(rows[0]?.textContent).toContain("Complete");
    expect(rows[0]?.textContent).toContain("1.5 s");
  } finally {
    unmount();
  }
});

it("report QA-1795110018.875309 shows each runnable cell's upstream dependencies in Graph mode", () => {
  const graphCells = [
    { id: "c1", contents: { kind: "sql", source: "select 1", order: "a" } },
    {
      id: "c2",
      contents: { kind: "sql", source: "select * from c1_result", order: "b" },
    },
  ] as unknown as Cell[];
  const { container, unmount } = mount(
    <ProjectGraphView
      cells={graphCells}
      titles={
        new Map([
          ["c1", "Revenue query"],
          ["c2", "Rollup"],
        ])
      }
    />,
  );
  try {
    expect(
      container.querySelector('[data-testid="project-graph-view"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Revenue query");
    expect(container.textContent).toContain("Rollup");
  } finally {
    unmount();
  }
});
