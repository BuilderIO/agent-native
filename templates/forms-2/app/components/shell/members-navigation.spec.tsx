// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { CommandMenu } from "../command-menu/CommandMenu";
import { Sidebar } from "./Sidebar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: { workspaces: [] }, isPending: false }),
  useActionMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@agent-native/toolkit/app/org", () => ({ OrgSwitcher: () => null }));
vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentToggleButton: () => null,
}));
vi.mock("@agent-native/toolkit/app/shared", () => ({
  openCommandMenu: vi.fn(),
  CommandMenu: Object.assign(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
    {
      Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Item: ({
        children,
        onSelect,
      }: {
        children: ReactNode;
        onSelect: () => void;
      }) => <button onClick={onSelect}>{children}</button>,
    },
  ),
}));

describe("Members navigation", () => {
  for (const surface of ["sidebar", "command menu"] as const) {
    it(`${surface} opens the member list rather than organization general`, async () => {
      const host = document.createElement("div");
      document.body.append(host);
      const router = createMemoryRouter([
        {
          path: "/",
          element:
            surface === "sidebar" ? (
              <Sidebar onOpenTrash={() => undefined} />
            ) : (
              <CommandMenu open onOpenChange={() => undefined} />
            ),
        },
        {
          path: "/settings/:section",
          element: <div>Settings destination</div>,
        },
      ]);
      const root = createRoot(host);
      try {
        await act(async () => root.render(<RouterProvider router={router} />));
        const member = [...host.querySelectorAll<HTMLElement>("a,button")].find(
          (element) => element.textContent === "forms.common.members",
        );
        expect(member).toBeDefined();
        await act(async () => member!.click());
        expect(router.state.location.pathname).toBe("/settings/members");
      } finally {
        await act(async () => root.unmount());
        router.dispose();
        host.remove();
      }
    });
  }
});
