// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@agent-native/core/client/i18n",
  async () => (await import("@/skins/reference/testing/i18n")).i18nMock,
);

import { ProjectHeader } from "./ProjectHeader";

const reactActEnvironment = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
});

function mount(
  onRename: (title: string) => Promise<void>,
  onSaveDescription = vi.fn(async () => {}),
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <MemoryRouter>
        <ProjectHeader
          title="Untitled project"
          canRename
          onRename={onRename}
          onSaveDescription={onSaveDescription}
          renderWorkbench={(metadata) => metadata}
        />
      </MemoryRouter>,
    ),
  );
  return onSaveDescription;
}
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected element or setter");
  return value;
}
function editTitle() {
  act(() =>
    required(
      host.querySelector<HTMLButtonElement>(".nb-empty-title button"),
    ).click(),
  );
  return required(
    host.querySelector<HTMLInputElement>(".nb-empty-title input"),
  );
}
function change(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  act(() => {
    required(Object.getOwnPropertyDescriptor(prototype, "value")?.set).call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function key(input: HTMLElement, value: string) {
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true }),
    ),
  );
}

describe("empty notebook metadata", () => {
  it("clears the default title, cancels Escape, and saves a changed title once on Enter", async () => {
    const save = vi.fn(async () => {});
    mount(save);
    let input = editTitle();
    expect(input.value).toBe("");
    change(input, "Cancelled");
    key(input, "Escape");
    expect(save).not.toHaveBeenCalled();
    input = editTitle();
    act(() => input.blur());
    expect(save).not.toHaveBeenCalled();
    input = editTitle();
    change(input, "Renamed");
    await act(async () => {
      key(input, "Enter");
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("Renamed");
  });

  it("retains a failed description draft for retry", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    mount(async () => {}, save);
    act(() =>
      required(
        host.querySelector<HTMLButtonElement>(".nb-project-description"),
      ).click(),
    );
    const input = required(
      host.querySelector<HTMLTextAreaElement>(".nb-project-description-input"),
    );
    change(input, "New description");
    await act(async () => {
      key(input, "Enter");
    });
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(input.value).toBe("New description");
    act(() => input.focus());
    await act(async () => {
      key(input, "Enter");
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("New description");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
