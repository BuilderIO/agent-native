// @vitest-environment jsdom

import type { NavigationEntry } from "@agent-native/toolkit/app-shell/sidebar-shell";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";

import { MoreMenu } from "./menus";

it("renders no More trigger when every child is hidden", () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const child = (id: string) => ({ id, order: 0, visible: false });
  const entry = {
    id: "sidebar.more.open",
    label: "More",
    children: [child("a"), child("b")],
  } as unknown as NavigationEntry;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <MemoryRouter>
        <MoreMenu entry={entry} effects={[]} />
      </MemoryRouter>,
    ),
  );
  expect(host.querySelector("button")).toBeNull();
  act(() => root.unmount());
  host.remove();
});
