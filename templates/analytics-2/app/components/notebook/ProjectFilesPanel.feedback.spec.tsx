// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ProjectFilesPanel } from "./ProjectFilesPanel";

const hooks = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: { files: [] },
    error: hooks.error,
    isPending: false,
    refetch: vi.fn(),
  }),
  useActionMutation: () => ({
    mutateAsync: vi.fn(async () => ({ dataset: { name: "a", rowCount: 3 } })),
    isPending: false,
  }),
  callAction: vi.fn(),
  actionErrorMessage: () => undefined,
}));

async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(<ProjectFilesPanel projectId="qa-csv-1" onClose={() => {}} />),
  );
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}
async function choose(container: HTMLElement, label: string, file: File) {
  const input = container.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  );
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input?.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("clears a previous import result when the next CSV is rejected", async () => {
  hooks.error = null;
  const view = await mount();
  try {
    await choose(
      view.container,
      "Import CSV for querying",
      new File(["a\n1\n"], "a.csv"),
    );
    expect(view.container.querySelector('[role="status"]')).not.toBeNull();
    await choose(
      view.container,
      "Import CSV for querying",
      new File([], "empty.csv"),
    );
    expect(view.container.querySelector('[role="status"]')).toBeNull();
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
  } finally {
    await view.unmount();
  }
});

it("offers Retry only when the file list failed to load", async () => {
  hooks.error = null;
  let view = await mount();
  try {
    await choose(
      view.container,
      "Import CSV for querying",
      new File([], "empty.csv"),
    );
    expect(view.container.textContent).not.toContain("Retry");
  } finally {
    await view.unmount();
  }
  hooks.error = new Error("load failed");
  view = await mount();
  try {
    expect(view.container.textContent).toContain("Retry");
  } finally {
    await view.unmount();
  }
});
