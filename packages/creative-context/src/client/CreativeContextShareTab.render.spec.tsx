// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./actions.js", () => ({
  parseCreativeContexts: (data: unknown) => data ?? [],
  parseContextMembershipsForResource: () => [],
  useCreativeContexts: () => ({
    data: [
      {
        id: "ctx-1",
        name: "Marketing",
        kind: "default",
        memberCount: 3,
        approvalPolicy: "open",
        access: { canAdmin: false, canReview: false, canSubmit: true },
      },
    ],
    refetch: vi.fn(),
  }),
  useContextMemberships: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useManageCreativeContext: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useManageContextMembership: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock("@agent-native/toolkit/ui", () => ({
  Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  Button: ({ children, ...rest }: React.ComponentProps<"button">) => (
    <button {...rest}>{children}</button>
  ),
  Checkbox: (props: { checked?: boolean }) => (
    <input type="checkbox" checked={props.checked} readOnly />
  ),
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
  Select: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  // Renders exactly what the app passes through, so the test can assert on
  // the stacking-fix props (data-agent-native-share-overlay + z-index class)
  // without depending on Radix's real popper/portal behavior in happy-dom.
  SelectContent: ({
    children,
    ...rest
  }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div data-testid="select-content" {...rest}>
      {children}
    </div>
  ),
  SelectItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectTrigger: ({ children }: React.PropsWithChildren) => (
    <button>{children}</button>
  ),
  SelectValue: (props: { placeholder?: string }) => (
    <span>{props.placeholder}</span>
  ),
  Sheet: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SheetContent: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  SheetDescription: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  SheetHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SheetTitle: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Tabs: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsContent: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  TabsList: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsTrigger: ({ children }: React.PropsWithChildren) => (
    <button>{children}</button>
  ),
  Textarea: (props: React.ComponentProps<"textarea">) => <textarea {...props} />,
}));

const { CreativeContextShareTab } = await import("./CreativeContextShareTab.js");

describe("CreativeContextShareTab context select stacking", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("marks the context select as a share overlay above the host popover", async () => {
    await act(async () => {
      root.render(
        <CreativeContextShareTab
          resource={{
            appId: "design",
            resourceType: "design",
            resourceId: "design-1",
            title: "Untitled design",
          }}
        />,
      );
    });

    const selectContents = container.querySelectorAll(
      '[data-testid="select-content"]',
    );
    expect(selectContents.length).toBeGreaterThan(0);
    selectContents.forEach((node) => {
      // Without these, this tab (embedded in ShareButton's high z-index
      // popover) renders its dropdown invisibly behind the popover, and a
      // click inside it is treated as an "outside" click that closes the
      // whole Share dialog. See ShareButton.tsx's SHARE_NESTED_OVERLAY_Z /
      // data-agent-native-share-overlay convention.
      expect(node.getAttribute("data-agent-native-share-overlay")).toBe("");
      expect(node.getAttribute("class") ?? "").toContain("z-[100020]");
    });
  });
});
