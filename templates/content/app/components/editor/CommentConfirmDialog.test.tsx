// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CommentConfirmDialog } from "./CommentConfirmDialog";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("focuses confirm, and counts as open until focus has gone back", async () => {
  const wrapperState = () =>
    container.querySelector("[data-state]")?.getAttribute("data-state");
  const statesWhenClosed: (string | null | undefined)[] = [];
  const onClosed = vi.fn(() => statesWhenClosed.push(wrapperState()));
  const render = (open: boolean) =>
    act(async () =>
      root.render(
        <CommentConfirmDialog
          open={open}
          onCancel={() => {}}
          title="Delete comment?"
          description="It's deleted for everyone."
          cancelLabel="Cancel"
          confirmLabel="Delete"
          onConfirm={() => {}}
          onClosed={onClosed}
        />,
      ),
    );

  await render(true);
  expect(document.activeElement?.textContent).toBe("Delete");
  expect(wrapperState()).toBe("open");

  await render(false);
  // Radix hands focus back on the tick after the dialog unmounts.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  // A comment row shows its hover-only actions for an open control inside,
  // so its menu button can still take focus when the dialog hands it back.
  expect(onClosed).toHaveBeenCalledOnce();
  expect(statesWhenClosed).toEqual(["open"]);
  expect(wrapperState()).toBe("closed");
});
