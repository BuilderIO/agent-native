import type { DesignSystemDefinition } from "@agent-native/toolkit/design-system";
import { ToolkitProvider } from "@agent-native/toolkit/provider";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { SettingsPartRenderer } from "@/components/ui/settings-part-renderer";
import { referenceDesignSystem } from "@/skins/reference/design-system";

export interface Mounted {
  container: HTMLDivElement;
  render: (ui: ReactNode) => void;
  unmount: () => void;
}

/** Mounts a panel under one design system, the reference one unless told otherwise. */
export function mount(
  ui: ReactNode,
  designSystem: DesignSystemDefinition = referenceDesignSystem,
): Mounted {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT =
    true;
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  const render = (next: ReactNode) =>
    act(() => {
      root.render(
        <ToolkitProvider designSystem={designSystem}>
          <SettingsPartRenderer>{next}</SettingsPartRenderer>
        </ToolkitProvider>,
      );
    });
  render(ui);
  return {
    container,
    render,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Lets pending promises and the state they set settle. */
export async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export function buttonByText(
  root: ParentNode,
  text: string,
): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  );
  if (!found) throw new Error(`no button with text ${text}`);
  return found;
}

export function click(element: Element): void {
  act(() => {
    (element as HTMLElement).click();
  });
}

/** Sets a text control's value the way typing does, so React sees the change. */
export function type(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
      element,
      value,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
