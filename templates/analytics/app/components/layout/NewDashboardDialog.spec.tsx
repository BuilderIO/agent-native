// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useSendToAgentChat: () => ({
    send: clientMocks.send,
    isGenerating: false,
  }),
}));

vi.mock("@agent-native/core/client/composer", () => ({
  PromptComposer: ({
    onSubmit,
    layoutVariant,
  }: {
    onSubmit: (value: string) => void;
    layoutVariant?: string;
  }) => (
    <div data-layout-variant={layoutVariant}>
      <button
        type="button"
        data-testid="prompt-submit"
        onClick={() => onSubmit("Create a usage dashboard")}
      >
        submit
      </button>
    </div>
  ),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tabler/icons-react", () => ({
  IconPlus: () => <span aria-hidden="true" />,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { NewDashboardDialog } from "./NewDashboardDialog";

describe("NewDashboardDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("starts dashboard creation in an isolated chat tab", async () => {
    await act(async () => {
      root.render(<NewDashboardDialog />);
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-testid=prompt-submit]")
        ?.click();
    });

    expect(clientMocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Create a usage dashboard",
        submit: true,
        newTab: true,
        reuseEmptyTab: true,
      }),
    );
  });

  it("uses the compact composer frame inside the popover", async () => {
    await act(async () => {
      root.render(<NewDashboardDialog />);
    });

    expect(
      container
        .querySelector("[data-layout-variant]")
        ?.getAttribute("data-layout-variant"),
    ).toBe("compact");
  });
});
