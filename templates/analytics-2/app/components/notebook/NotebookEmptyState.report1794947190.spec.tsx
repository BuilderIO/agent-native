// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { assert, expect, it, vi } from "vitest";

import { NotebookEmptyState } from "./NotebookEmptyState";

it("shows Ask setup feedback, preserves the question, and avoids duplicate sends", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let reject: ((error: Error) => void) | undefined;
  const ask = vi.fn(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <NotebookEmptyState
        connections={[]}
        emptyState={{ onAskDataQuestion: ask }}
      />,
    ),
  );
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="What would you like to know?"]',
  );
  assert(input);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    assert(setter);
    setter.call(input, "Show billing");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const form = input.form;
  assert(form);
  await act(async () => {
    form.requestSubmit();
    form.requestSubmit();
  });
  expect(ask).toHaveBeenCalledTimes(1);
  expect(form.getAttribute("aria-busy")).toBe("true");
  const rejectDelivery = reject;
  assert(rejectDelivery);
  await act(async () =>
    rejectDelivery(new Error("Connect AI to start chatting")),
  );
  expect(input.value).toBe("Show billing");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Connect AI to start chatting",
  );
  await act(async () => root.unmount());
  container.remove();
});

it("keeps the question and allows retry after a synchronous delivery failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const ask = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error("Delivery failed");
    })
    .mockResolvedValueOnce(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <NotebookEmptyState
          connections={[]}
          emptyState={{ onAskDataQuestion: ask }}
        />,
      ),
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="What would you like to know?"]',
    );
    assert(input);
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    assert(setter);
    await act(async () => {
      setter.call(input, "Show billing");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = input.form;
    assert(form);
    await act(async () => form.requestSubmit());
    expect(input.value).toBe("Show billing");
    expect(form.getAttribute("aria-busy")).toBe("false");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => form.requestSubmit());
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask).toHaveBeenLastCalledWith("Show billing");
    expect(input.value).toBe("");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
