// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeepSelectGuidance } from "./DeepSelectGuidance";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { modifier?: string }) =>
    key === "designEditor.deepSelectGuidance.message"
      ? `Hold ${options?.modifier} and click to select an inner layer.`
      : key,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/hooks/use-shortcut-label", () => ({
  useApplePlatform: () => true,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("DeepSelectGuidance", () => {
  it("does not bubble body clicks into the canvas background", async () => {
    const onDismiss = vi.fn();
    const onCanvasClick = vi.fn();

    await act(async () => {
      root.render(
        <div onClick={onCanvasClick}>
          <DeepSelectGuidance onDismiss={onDismiss} onExpire={() => {}} />
        </div>,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLElement>("[role='status']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });

    expect(onCanvasClick).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("expires on its own instead of staying pinned", async () => {
    vi.useFakeTimers();
    try {
      const onExpire = vi.fn();
      await act(async () => {
        root.render(
          <DeepSelectGuidance onDismiss={() => {}} onExpire={onExpire} />,
        );
      });
      await act(async () => {
        vi.advanceTimersByTime(4999);
      });
      expect(onExpire).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(onExpire).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
