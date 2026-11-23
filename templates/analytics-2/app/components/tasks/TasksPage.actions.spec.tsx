// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// A task row must carry what the source's task header carries: Run now
// (components/tasks/TaskHeaderActions.tsx:257) and a "Task actions" menu
// (:287 aria-label) whose items are Pause/Resume (:280) and Delete (:295).
// The row is only allowed to offer them because the framework's own
// automation actions back them, so these assertions bind the control to the
// action that performs it.
const task = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "qa-rebuild-analytics-2",
  scope: "personal" as const,
  schedule: "0 9 * * 1",
  timezone: "UTC",
  enabled: true,
  nextRun: "2026-11-16T09:00:00.000Z",
  lastRun: null,
  lastStatus: null,
  lastError: null,
  canUpdate: true,
};

const mutateAsync = vi.fn(async (_name: string, _input: unknown) => ({}));
const refetch = vi.fn(async () => ({}));

// The action answers with the rows themselves; a `{ tasks }` wrapper here would
// hide every row behind the empty state.
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) =>
    name === "describe-models"
      ? {
          data: { models: [{ modelId: "model-a", name: "Model A" }] },
          isLoading: false,
          error: null,
        }
      : {
          data: [task],
          isLoading: false,
          error: null,
          refetch,
        },
  useActionMutation: (name: string) => ({
    mutateAsync: (input: unknown) => mutateAsync(name, input),
    isPending: false,
  }),
}));

const { TasksPage } = await import("./TasksPage");

it("offers Run now and Task actions on a task row, backed by the framework actions", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<TasksPage />);
  });

  const buttons = [...container.querySelectorAll("button")];
  const runNow = buttons.find((button) =>
    /run now/i.test(button.textContent ?? ""),
  );
  expect(runNow).toBeDefined();

  const actions = container.querySelector(
    'button[aria-label="Task actions"]',
  ) as HTMLButtonElement | null;
  expect(actions).not.toBeNull();
  expect(container.textContent).toContain(task.name);
  // The create dialog's model picker (source: the prompt footer's model picker).
  // It lives in the dialog, so open the dialog first.
  const newTask = buttons.find((button) =>
    /new task/i.test(button.textContent ?? ""),
  );
  await act(async () => {
    newTask!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(document.querySelector('button[aria-label="Model"]')).not.toBeNull();
  expect(container.textContent).not.toContain("No tasks yet");

  await act(async () => {
    runNow!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(mutateAsync).toHaveBeenCalledWith("run-automation-now", {
    resourceId: task.id,
    scope: "personal",
  });

  await act(async () => {
    root.unmount();
  });
  container.remove();
});
