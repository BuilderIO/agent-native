import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { onTestFinished } from "vitest";

// Shared render harness for Content component tests. Tests that use it must
// declare `// @vitest-environment happy-dom`. It exists so that asserting on
// real rendered behavior (focus, disabled state, what the user sees) is as
// cheap as reading a component's source text, which breaks on harmless
// refactors and keeps passing when the behavior itself regresses.

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };

/**
 * Mounts `ui` in the document inside a fresh QueryClient and unmounts it when
 * the current test finishes.
 */
export function renderUi(ui: ReactNode) {
  const actEnvironment = globalThis as ActEnvironment;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function rerender(next: ReactNode) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>{next}</QueryClientProvider>,
      );
    });
  }

  rerender(ui);
  onTestFinished(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    document.body.replaceChildren();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  return { container, rerender };
}

/** Returns the element with this exact accessible label, or throws. */
export function byLabel<T extends HTMLElement = HTMLElement>(
  label: string,
  scope: ParentNode = document.body,
): T {
  const element = queryByLabel<T>(label, scope);
  if (!element) throw new Error(`No element labelled "${label}"`);
  return element;
}

export function queryByLabel<T extends HTMLElement = HTMLElement>(
  label: string,
  scope: ParentNode = document.body,
): T | null {
  // Compare attribute values directly so labels never need CSS escaping.
  return (
    Array.from(scope.querySelectorAll<T>("[aria-label]")).find(
      (element) => element.getAttribute("aria-label") === label,
    ) ?? null
  );
}

/**
 * Clicks like a pointer user: pointerdown and mousedown (which move focus
 * unless a handler prevents it), then pointerup, mouseup, and click. Pending
 * promise work settles before this resolves.
 */
export async function click(element: Element) {
  const init = { bubbles: true, cancelable: true, button: 0 };
  await act(async () => {
    const pointerDownAllowed = element.dispatchEvent(
      new PointerEvent("pointerdown", init),
    );
    if (pointerDownAllowed) {
      const mouseDownAllowed = element.dispatchEvent(
        new MouseEvent("mousedown", init),
      );
      if (mouseDownAllowed && element instanceof HTMLElement) element.focus();
    }
    element.dispatchEvent(new PointerEvent("pointerup", init));
    if (pointerDownAllowed) {
      element.dispatchEvent(new MouseEvent("mouseup", init));
    }
    element.dispatchEvent(new MouseEvent("click", init));
    await settleTasks();
  });
}

/**
 * Moves focus to `element` the way keyboard navigation does. Focus handlers
 * often update component state, so this runs inside act.
 */
export async function focus(element: HTMLElement) {
  await act(async () => {
    element.focus();
    await settleTasks();
  });
}

/** Presses and releases a key on `element`, then lets pending work settle. */
export async function press(
  element: Element,
  key: string,
  init: KeyboardEventInit = {},
) {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keyup", { key, bubbles: true, ...init }),
    );
    await settleTasks();
  });
}

/** Replaces a text control's value the way typing does for React. */
export async function typeInto(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
      control,
      value,
    );
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    await settleTasks();
  });
}

/**
 * Waits for the next animation frame, so work components schedule with
 * requestAnimationFrame (focus moves, measurement) has run.
 */
export async function nextFrame() {
  await act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );
}

function settleTasks() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
