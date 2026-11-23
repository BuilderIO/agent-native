// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const mutateAsync = vi.fn(async (_name: string, _input: unknown) => ({}));
const refetch = vi.fn(async () => ({}));

const queryResults = new Map<
  string,
  { data: unknown; isLoading: boolean; error: null; refetch: typeof refetch }
>();
const mutationResults = new Map<
  string,
  { mutateAsync: (input: unknown) => Promise<unknown>; isPending: boolean }
>();

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) => {
    let result = queryResults.get(name);
    if (!result) {
      result = {
        data:
          name === "describe-models"
            ? {
                models: [
                  { modelId: "claude-sonnet", shortName: "Sonnet" },
                  { modelId: "gpt-terra", name: "Terra" },
                ],
              }
            : name === "list-task-destinations"
              ? [
                  {
                    kind: "user",
                    id: "alice@example.test",
                    label: "Alice",
                    platform: "email",
                  },
                  {
                    kind: "slack",
                    id: "slack-1",
                    label: "#analytics",
                    platform: "slack",
                  },
                ]
              : [],
        isLoading: false,
        error: null,
        refetch,
      };
      queryResults.set(name, result);
    }
    return result;
  },
  useActionMutation: (name: string) => {
    let result = mutationResults.get(name);
    if (!result) {
      result = {
        mutateAsync: (input: unknown) => mutateAsync(name, input),
        isPending: false,
      };
      mutationResults.set(name, result);
    }
    return result;
  },
}));

const { TasksPage } = await import("./TasksPage");

function setValue(element: Element | null, value: string) {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
  element!.dispatchEvent(new Event("input", { bubbles: true }));
}

async function openComposer() {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    createRoot(container).render(<TasksPage />);
  });
  const newTask = [...container.querySelectorAll("button")].find((button) =>
    /new task/i.test(button.textContent ?? ""),
  );
  await act(async () => {
    newTask!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const click = async (label: RegExp) => {
  const button = [...document.querySelectorAll("button")].find((candidate) =>
    label.test(candidate.textContent ?? ""),
  );
  await act(async () => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

beforeEach(() => {
  document.body.innerHTML = "";
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({});
});

it("sends every field the composer shows when Create task is clicked", async () => {
  await openComposer();
  await act(async () => {
    setValue(document.getElementById("task-title"), "Weekly ARR");
    setValue(document.getElementById("task-prompt"), "Summarize ARR");
    setValue(document.getElementById("task-end-date"), "2027-01-31");
  });
  await click(/^create task$/i);
  expect(mutateAsync).toHaveBeenCalledWith(
    "create-scheduled-task",
    expect.objectContaining({
      operation: "create",
      title: "Weekly ARR",
      prompt: "Summarize ARR",
      endDate: "2027-01-31",
    }),
  );
});

it("shows the failure when the task cannot be created", async () => {
  mutateAsync.mockRejectedValue(
    new Error("The hour must be between 0 and 23."),
  );
  await openComposer();
  await act(async () => {
    setValue(document.getElementById("task-title"), "Weekly ARR");
    setValue(document.getElementById("task-prompt"), "Summarize ARR");
  });
  await click(/^create task$/i);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "The hour must be between 0 and 23.",
  );
});

it("requires a title before creating", async () => {
  await openComposer();
  await act(async () => {
    setValue(document.getElementById("task-prompt"), "Summarize ARR");
  });
  await click(/^create task$/i);
  expect(mutateAsync).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Title is required for task",
  );
});

it.each([
  ["task-hour", "", /hour/i],
  ["task-hour", "24", /hour/i],
  ["task-hour", "9am", /hour/i],
])(
  "rejects a bad time (%s=%j) without calling the action",
  async (id, value, message) => {
    await openComposer();
    await act(async () => {
      setValue(document.getElementById("task-title"), "Weekly ARR");
      setValue(document.getElementById("task-prompt"), "Summarize ARR");
      setValue(document.getElementById(id), value);
    });
    await click(/^create task$/i);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(
      message,
    );
  },
);

it("rejects a blank minute instead of scheduling minute zero", async () => {
  await openComposer();
  await act(async () => {
    setValue(document.getElementById("task-title"), "Weekly ARR");
    setValue(document.getElementById("task-prompt"), "Summarize ARR");
    setValue(document.querySelector('[aria-label="Minute"]'), "");
  });
  await click(/^create task$/i);
  expect(mutateAsync).not.toHaveBeenCalled();
});

it("keeps the composer open on Escape so a typed prompt is not lost", async () => {
  await openComposer();
  expect(document.getElementById("task-prompt")).not.toBeNull();
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(document.getElementById("task-prompt")).not.toBeNull();
});

it("sends expiration date selected in a separate step after prompt and title, and resets fields after create", async () => {
  await openComposer();
  await act(async () => {
    setValue(document.getElementById("task-title"), "Weekly ARR");
    setValue(document.getElementById("task-prompt"), "Summarize ARR");
  });
  await act(async () => {
    setValue(document.getElementById("task-end-date"), "2027-06-30");
  });
  await click(/^create task$/i);
  expect(mutateAsync).toHaveBeenCalledWith(
    "create-scheduled-task",
    expect.objectContaining({
      operation: "create",
      title: "Weekly ARR",
      prompt: "Summarize ARR",
      endDate: "2027-06-30",
    }),
  );

  await click(/^new task$/i);
  expect(
    (document.getElementById("task-end-date") as HTMLInputElement | null)
      ?.value,
  ).toBe("");
  expect(
    document.querySelector('input[type="file"][aria-label="Attach file"]'),
  ).not.toBeNull();
  expect(document.querySelector('[aria-label="Model"]')).not.toBeNull();
  expect(document.getElementById("task-notification")).not.toBeNull();
});
