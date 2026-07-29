import { cleanup, fireEvent, render } from "@testing-library/react";
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { DrawOverlay } from "./DrawOverlay";

afterEach(() => {
  cleanup();
});

describe("DrawOverlay", () => {
  it("exits annotation mode when Escape is pressed anywhere", () => {
    const onClose = vi.fn();
    render(<DrawOverlay visible onClose={onClose} onSend={vi.fn()} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("removes the Escape listener when hidden", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <DrawOverlay visible onClose={onClose} onSend={vi.fn()} />,
    );

    rerender(
      <DrawOverlay visible={false} onClose={onClose} onSend={vi.fn()} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });
});
