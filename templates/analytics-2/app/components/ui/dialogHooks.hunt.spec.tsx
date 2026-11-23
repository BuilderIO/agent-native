// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useConfirmDialogBehavior } from "./useConfirmDialogBehavior";
import { useDialogEscape } from "./useDialogEscape";

function EscapeDialog({ onClose }: { onClose: () => void }) {
  useDialogEscape(onClose);
  return <input data-testid="field" autoFocus />;
}

function ConfirmDialog({ onCancel }: { onCancel: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useConfirmDialogBehavior({ onCancel, confirmRef });
  return (
    <button ref={confirmRef} type="button">
      Confirm
    </button>
  );
}

function press(init: KeyboardEventInit) {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, ...init }),
    );
  });
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let opener: HTMLButtonElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  opener.remove();
});

it("Escape that cancels an IME composition does not close the dialog", () => {
  const onClose = vi.fn();
  act(() => root.render(<EscapeDialog onClose={onClose} />));
  press({ isComposing: true });
  expect(onClose).not.toHaveBeenCalled();
  press({});
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("Escape that cancels an IME composition does not cancel a confirmation", () => {
  const onCancel = vi.fn();
  act(() => root.render(<ConfirmDialog onCancel={onCancel} />));
  press({ isComposing: true });
  expect(onCancel).not.toHaveBeenCalled();
  press({});
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("closing a dialog returns focus to the control that opened it", () => {
  act(() => root.render(<EscapeDialog onClose={() => {}} />));
  expect(document.activeElement).toBe(container.querySelector("input"));
  act(() => root.render(<div />));
  expect(document.activeElement).toBe(opener);
});

it("closing a confirmation returns focus to the control that opened it", () => {
  act(() => root.render(<ConfirmDialog onCancel={() => {}} />));
  expect(document.activeElement).toBe(container.querySelector("button"));
  act(() => root.render(<div />));
  expect(document.activeElement).toBe(opener);
});

it("does not pull focus back when the user moved it elsewhere", () => {
  act(() => root.render(<EscapeDialog onClose={() => {}} />));
  const other = document.createElement("button");
  document.body.append(other);
  other.focus();
  act(() => root.render(<div />));
  expect(document.activeElement).toBe(other);
  other.remove();
});
