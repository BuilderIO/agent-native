// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectionResult: null as null | {
    data?: {
      connections?: Array<{
        id: string;
        name?: string | null;
        devServerUrl?: string | null;
        routes?: Array<{ path: string; title?: string }>;
      }>;
    };
    error?: unknown;
    isFetching: boolean;
  },
  mutate: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ isPending: false, mutate: mocks.mutate }),
  useActionQuery: () => mocks.connectionResult,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (
      key: string,
      options?: { defaultValue?: string; path?: string },
    ): string => {
      if (key === "designEditor.addLocalhostScreen.useCustomPath") {
        return `Add "${options?.path ?? ""}"`;
      }
      return (
        (
          {
            "designEditor.addLocalhostScreen.noRoutes": "No matching routes",
            "common.genericError": "Something went wrong",
          } as Record<string, string>
        )[key] ??
        options?.defaultValue ??
        key
      );
    },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@tabler/icons-react", () => ({
  IconDeviceDesktop: () => null,
  IconDeviceMobile: () => null,
  IconPlus: () => null,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandEmpty: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandInput: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    placeholder: string;
  }) => (
    <input
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
      placeholder={placeholder}
    />
  ),
  CommandItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  CommandList: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: () => null,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

import { AddLocalhostScreenDialog } from "./AddLocalhostScreenDialog";

describe("AddLocalhostScreenDialog localhost route selection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.connectionResult = { isFetching: true };
    mocks.mutate.mockReset();
    mocks.invalidateQueries.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function renderDialog(connectionId?: string) {
    act(() =>
      root.render(
        <AddLocalhostScreenDialog
          open
          onOpenChange={vi.fn()}
          designId="design-1"
          connectionId={connectionId}
        />,
      ),
    );
  }

  function searchFor(path: string) {
    const input = container.querySelector("input");
    if (!input) throw new Error("route search input was not rendered");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, path);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("keeps the route list in a loading state until connections arrive", () => {
    renderDialog();

    expect(container.querySelectorAll("[data-testid='skeleton']")).toHaveLength(
      6,
    );
    expect(container.textContent).not.toContain("No matching routes");
    expect(container.textContent).not.toContain('Add "/login"');
  });

  it("does not use cached routes while the connection request is loading", () => {
    mocks.connectionResult = {
      data: {
        connections: [
          {
            id: "localhost-1",
            routes: [{ path: "/cached" }],
          },
        ],
      },
      isFetching: true,
    };
    renderDialog("localhost-1");
    searchFor("/cached");

    expect(container.textContent).not.toContain("/cached");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("does not use cached routes after the connection request fails", () => {
    mocks.connectionResult = {
      data: {
        connections: [
          {
            id: "localhost-1",
            routes: [{ path: "/cached" }],
          },
        ],
      },
      error: new Error("Connection list unavailable"),
      isFetching: false,
    };
    renderDialog("localhost-1");
    searchFor("/cached");

    expect(container.textContent).toContain("Something went wrong");
    expect(container.textContent).not.toContain("/cached");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("does not offer a custom route when no connection can receive it", () => {
    mocks.connectionResult = {
      data: { connections: [] },
      isFetching: false,
    };
    renderDialog();
    searchFor("/login");

    expect(container.textContent).toContain("No matching routes");
    expect(container.textContent).not.toContain('Add "/login"');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("adds a custom route through the selected localhost connection", () => {
    mocks.connectionResult = {
      data: {
        connections: [{ id: "localhost-1", name: "Local app", routes: [] }],
      },
      isFetching: false,
    };
    renderDialog();
    searchFor("/login");

    const addRoute = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes('Add "/login"'),
    );
    expect(addRoute).toBeDefined();
    act(() => addRoute?.click());

    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(
      {
        designId: "design-1",
        connectionId: "localhost-1",
        routes: [{ path: "/login", width: 1280, height: 900, x: 0, y: 0 }],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
