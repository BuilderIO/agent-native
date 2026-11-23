// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) =>
    name === "describe-models"
      ? { data: { models: [] }, isLoading: false, error: null }
      : { data: [], isLoading: false, error: null, refetch: async () => ({}) },
  useActionMutation: () => ({
    mutateAsync: async () => ({}),
    isPending: false,
  }),
}));

const { TasksPage } = await import("./TasksPage");

it("draws the empty state with an illustration, one New task button and no filter pills", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<TasksPage />);
  });

  const page = container.querySelector('[data-list-page="tasks"]');
  expect(page).not.toBeNull();
  const illustration = page?.querySelector(
    '.analytics-workspace-list-content [data-testid="workspace-list-empty-illustration"]',
  );
  expect(illustration?.getAttribute("width")).toBe("240");
  expect(illustration?.getAttribute("height")).toBe("240");
  expect(
    page?.querySelector(".analytics-workspace-list-empty-actions button")
      ?.textContent,
  ).toBe("Create from scratch");
  const labels = [...container.querySelectorAll("button")].map(
    (button) => button.textContent,
  );
  expect(labels.filter((label) => /new task/i.test(label ?? ""))).toHaveLength(
    1,
  );
  expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  expect(container.textContent).not.toMatch(/search/i);
});
