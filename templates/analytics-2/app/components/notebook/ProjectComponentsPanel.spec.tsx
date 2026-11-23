// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { ProjectComponentsPanel } from "./ProjectComponentsPanel";

// The Components tab lists the workspace's real component snapshots, and says so
// plainly when there are none - it never invents an entry.
it("lists components with their cell counts", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ProjectComponentsPanel
        components={[
          {
            id: "c1",
            name: "Revenue blocks",
            sourceProjectId: "p1",
            cellCount: 3,
            updatedAt: "2026-11-12T00:00:00Z",
          },
        ]}
        onClose={() => {}}
      />,
    ),
  );
  expect(container.textContent).toContain("Revenue blocks");
  expect(container.textContent).toContain("3 cells");
  act(() => root.unmount());
  container.remove();
});

it("shows the empty state when the workspace has no components", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(<ProjectComponentsPanel components={[]} onClose={() => {}} />),
  );
  expect(container.textContent).toContain("No components yet");
  act(() => root.unmount());
  container.remove();
});

it("report QA-1795073405 styles component list rows with structured flex layout", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ProjectComponentsPanel
        components={[
          {
            id: "c1",
            name: "Revenue blocks",
            sourceProjectId: "p1",
            cellCount: 3,
            updatedAt: "2026-11-12T00:00:00Z",
          },
        ]}
        onClose={() => {}}
      />,
    ),
  );
  const list = container.querySelector(".nb-component-list");
  const row = container.querySelector(".nb-component-row");
  const name = container.querySelector(".nb-component-name");
  expect(list?.className).toContain("flex");
  expect(row?.className).toContain("items-center");
  expect(name?.className).toContain("truncate");
  act(() => root.unmount());
  container.remove();
});
