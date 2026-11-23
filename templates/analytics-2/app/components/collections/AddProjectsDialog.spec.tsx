// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const callAction = vi.fn();
const query = vi.hoisted(() => ({ failed: false, refetch: vi.fn() }));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => callAction(...args),
  useActionQuery: () => ({
    isPending: false,
    isError: query.failed,
    refetch: query.refetch,
    data: query.failed
      ? undefined
      : { projects: [{ id: "p1", title: "Revenue" }] },
  }),
}));
vi.mock("@agent-native/core/client/i18n", async () => {
  const messages = (await import("../../i18n/en-US")).default as Record<
    string,
    unknown
  >;
  const lookup = (key: string): string => {
    let node: unknown = messages;
    for (const part of key.split(".")) {
      node = (node as Record<string, unknown> | undefined)?.[part];
    }
    return typeof node === "string" ? node : key;
  };
  return { useT: () => (key: string) => lookup(key) };
});

import { AddProjectsDialog } from "./AddProjectsDialog";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

afterEach(() => {
  document.body.innerHTML = "";
  callAction.mockReset();
  query.failed = false;
  query.refetch.mockReset();
});

describe("AddProjectsDialog while the add is in flight", () => {
  it("reports a failed project list and retries instead of claiming all projects are filed", async () => {
    query.failed = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <AddProjectsDialog collectionId="c1" alreadyFiled={[]} onClose={() => {}} />,
      ),
    );
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Could not load projects.",
    );
    expect(container.textContent).not.toContain(
      "Every project is already in this collection.",
    );
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    )!;
    act(() => retry.click());
    expect(query.refetch).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
  it("ignores Escape and disables Cancel until the request settles", async () => {
    callAction.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <AddProjectsDialog
          collectionId="c1"
          alreadyFiled={[]}
          onClose={onClose}
        />,
      ),
    );
    await act(async () =>
      container.querySelector<HTMLInputElement>("input")?.click(),
    );
    const button = (name: string) =>
      [...container.querySelectorAll("button")].find(
        (candidate) => candidate.textContent === name,
      ) as HTMLButtonElement;
    await act(async () => button("Add to collection").click());
    expect(callAction).toHaveBeenCalledTimes(1);
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(button("Cancel").disabled).toBe(true);
    await act(async () => root.unmount());
  });
});
