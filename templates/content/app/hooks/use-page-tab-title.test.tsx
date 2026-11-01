// @vitest-environment happy-dom

import { SessionPreloadContext } from "@agent-native/core/client/use-session";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePageTabTitle } from "./use-page-tab-title";

// With the session hint, the app mounts hidden while the session is read, so
// the page's editor can mount before the session confirms whose page it is.
// The browser tab is not hidden: it names the page only once the app shows.

function TabTitle({ title }: { title: string | null }) {
  usePageTabTitle(title);
  return null;
}

describe("the page's browser tab title", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.document.title = "Content";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(preloading: boolean, title: string | null) {
    act(() =>
      root.render(
        <SessionPreloadContext.Provider value={preloading}>
          <TabTitle title={title} />
        </SessionPreloadContext.Provider>,
      ),
    );
  }

  it("is not set while the app is mounted hidden ahead of the session", () => {
    render(true, "Salary review — Content");

    expect(window.document.title).toBe("Content");
  });

  it("is set once the session lets the same tree show", () => {
    render(true, "Salary review — Content");
    render(false, "Salary review — Content");

    expect(window.document.title).toBe("Salary review — Content");
  });

  it("goes back to the earlier title when the page closes", () => {
    render(false, "Salary review — Content");
    render(false, null);

    expect(window.document.title).toBe("Content");
  });
});
