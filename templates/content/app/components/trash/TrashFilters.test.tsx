// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { TrashFilters } from "./TrashFilters";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({
    open,
    children,
  }: {
    open?: boolean;
    children: React.ReactNode;
  }) =>
    open === false ? (
      <>{(children as React.ReactElement[])[0]}</>
    ) : (
      <>{children}</>
    ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tip">{children}</div>
  ),
}));

const spaces = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
] as never;

function render(filters: object, spaceList = spaces) {
  const host = document.createElement("div");
  act(() => {
    createRoot(host).render(
      createElement(TrashFilters, {
        filters,
        spaces: spaceList,
        onChange: vi.fn(),
        onEmptyTrash: vi.fn(),
      }),
    );
  });
  return host;
}

describe("Empty Trash with several workspaces", () => {
  it("explains why it is disabled until a workspace is chosen", () => {
    const host = render({});
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="trash.emptyTrash"]',
    );
    expect(button?.disabled).toBe(true);
    expect(host.querySelector('[data-testid="tip"]')?.textContent).toBe(
      "trash.emptyTrashPickSpace",
    );
  });

  it("is enabled without a hint once a workspace filter is set", () => {
    const host = render({ spaceId: "a" });
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="trash.emptyTrash"]',
    );
    expect(button?.disabled).toBe(false);
    expect(host.querySelector('[data-testid="tip"]')).toBeNull();
  });

  it("shows no hint while the workspace list is empty", () => {
    const host = render({}, [] as never);
    expect(host.querySelector('[data-testid="tip"]')).toBeNull();
  });

  it("makes the disabled button's wrapper keyboard-focusable", () => {
    const host = render({});
    expect(host.querySelector("span[tabindex='0']")).not.toBeNull();
  });
});
