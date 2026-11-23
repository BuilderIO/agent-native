// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// A component cell with no component is a chooser for what this workspace has -
// not a dead end that asks the reader to choose with nothing to choose from.
const components = [
  { id: "c1", name: "Revenue blocks", cellCount: 2 },
  { id: "c2", name: "Churn table", cellCount: 1 },
];

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: { components },
    isPending: false,
    error: null,
  }),
}));

const { ComponentImportBody } = await import("./ComponentImportBody");

it("offers the workspace's components and reports the pick", () => {
  const onChoose = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ComponentImportBody
        componentId={null}
        title={null}
        onChoose={onChoose}
      />,
    ),
  );

  const select = container.querySelector(
    'select[aria-label="Component to show"]',
  ) as HTMLSelectElement | null;
  expect(select).not.toBeNull();
  expect(select!.options.length).toBe(components.length + 1);

  act(() => {
    select!.value = "c2";
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChoose).toHaveBeenCalledWith("c2", "Churn table");

  act(() => root.unmount());
  container.remove();
});
