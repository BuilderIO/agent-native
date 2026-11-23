// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { WorkspaceSearch } from "./WorkspaceSearch";

vi.mock("@/components/workspace/WorkspaceDataContext", () => ({
  useWorkspaceData: () => undefined,
}));

afterEach(() => {
  document.body.innerHTML = "";
});

it("returns focus to the search trigger when opened from a shortcut with no focused element", async () => {
  const trigger = document.createElement("button");
  trigger.setAttribute("data-search-trigger", "true");
  document.body.appendChild(trigger);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const props: Omit<React.ComponentProps<typeof WorkspaceSearch>, "open"> = {
    onClose: () => {},
    onSearch: async () => [],
    onOpenResult: () => {},
  } as never;
  await act(async () => root.render(<WorkspaceSearch open {...props} />));
  expect(document.activeElement).not.toBe(trigger);
  await act(async () =>
    root.render(<WorkspaceSearch open={false} {...props} />),
  );
  expect(document.activeElement).toBe(trigger);
  act(() => root.unmount());
});
