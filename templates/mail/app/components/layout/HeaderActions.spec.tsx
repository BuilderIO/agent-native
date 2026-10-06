// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useHeaderActions,
  useHeaderTitle,
  useSetHeaderActions,
  useSetPageTitle,
} from "./HeaderActions";

const title = "Inbox";
const actions = <button type="button">Priority</button>;

function PageSetter({ revision }: { revision: number }) {
  useSetPageTitle(title);
  useSetHeaderActions(actions);
  return <span data-page-revision={revision} />;
}

function App({ revision }: { revision: number }) {
  const currentTitle = useHeaderTitle();
  const currentActions = useHeaderActions();

  return (
    <>
      <header>
        <span>{currentTitle}</span>
        {currentActions}
      </header>
      <PageSetter revision={revision} />
    </>
  );
}

describe("HeaderActions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("does not loop when the page rerenders without changing its header", () => {
    act(() => root.render(<App revision={0} />));
    act(() => root.render(<App revision={1} />));

    expect(container.querySelector("header")?.textContent).toBe(
      "InboxPriority",
    );
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(
      container
        .querySelector("[data-page-revision]")
        ?.getAttribute("data-page-revision"),
    ).toBe("1");
  });
});
