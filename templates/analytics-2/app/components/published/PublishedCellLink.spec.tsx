// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { PublishedCellLink } from "./PublishedCellLink";

it("brings the linked published cell into view once, follows a new link on the page, and ignores bad ones", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  for (const id of ["a", "b"]) {
    const cell = document.createElement("div");
    cell.setAttribute("data-published-cell", id);
    container.append(cell);
  }
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  const open = async (hash: string) =>
    act(async () => {
      window.history.replaceState(null, "", hash);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  try {
    window.history.replaceState(null, "", "#cell-a");
    await act(async () =>
      root.render(<PublishedCellLink projectId="p" cellIds={["a", "b"]} />),
    );
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(
      container.querySelector('[data-published-cell="a"]'),
    );
    await act(async () =>
      root.render(<PublishedCellLink projectId="p" cellIds={["a", "b"]} />),
    );
    expect(scroll).toHaveBeenCalledTimes(1);
    await open("#cell-b");
    expect(scroll).toHaveBeenCalledTimes(2);
    for (const hash of ["#cell-%", "#cell-zzz", "#x"]) await open(hash);
    expect(scroll).toHaveBeenCalledTimes(2);
  } finally {
    window.history.replaceState(null, "", "#");
    await act(async () => root.unmount());
    container.remove();
    mount.remove();
  }
});
