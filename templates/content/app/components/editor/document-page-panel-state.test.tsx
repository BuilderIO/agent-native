// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type DocumentPagePanelTab,
  escapeWasHandled,
  firstFocusableIn,
  PAGE_PANEL_MARGIN_FADE_MS,
  pagePanelShortcut,
  leaveEscapeToPagePanel,
  usePagePanelMotion,
  usePagePanelShortcuts,
} from "./document-page-panel-state";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("pagePanelShortcut", () => {
  it.each([
    [{ key: "J", ctrlKey: true, shiftKey: true }, "agent"],
    [{ key: "j", metaKey: true, shiftKey: true }, "agent"],
    [{ key: "M", ctrlKey: true, shiftKey: true }, "comments"],
    [{ key: "m", metaKey: true, shiftKey: true }, "comments"],
    [{ key: "I", ctrlKey: true, shiftKey: true }, "info"],
    [{ key: "i", metaKey: true, shiftKey: true }, "info"],
    [{ key: "\\", code: "Backslash", ctrlKey: true }, "last"],
    [{ key: "\\", code: "Backslash", metaKey: true }, "last"],
  ] as const)("reads %o as %s", (init, shortcut) => {
    expect(pagePanelShortcut(key(init))).toBe(shortcut);
  });

  it("follows the letter, so M stays M on AZERTY", () => {
    expect(
      pagePanelShortcut(
        key({ key: "M", code: "Semicolon", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe("comments");
    // M's QWERTY key types ? there, and that stays nobody's shortcut.
    expect(
      pagePanelShortcut(
        key({ key: "?", code: "KeyM", ctrlKey: true, shiftKey: true }),
      ),
    ).toBeNull();
    expect(
      pagePanelShortcut(
        key({ key: "Q", code: "KeyA", ctrlKey: true, shiftKey: true }),
      ),
    ).toBeNull();
  });

  it("falls back to where the key sits on a layout without Latin letters", () => {
    expect(
      pagePanelShortcut(
        key({ key: "О", code: "KeyJ", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe("agent");
  });

  it.each([
    ["no Shift", { key: "i", ctrlKey: true }],
    ["no Control or Command", { key: "I", shiftKey: true }],
    ["AltGr", { key: "M", ctrlKey: true, altKey: true, shiftKey: true }],
    ["another letter", { key: "K", ctrlKey: true, shiftKey: true }],
    [
      "Shift on the backslash key",
      { key: "|", code: "Backslash", ctrlKey: true, shiftKey: true },
    ],
  ])("ignores %s", (_name, init) => {
    expect(pagePanelShortcut(key(init))).toBeNull();
  });
});

describe("usePagePanelShortcuts", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onShortcut = vi.fn();

  function Probe() {
    usePagePanelShortcuts(true, onShortcut);
    return (
      <>
        <button type="button" data-page-button />
        <div data-document-panel-agent>
          <div contentEditable data-agent-box />
        </div>
      </>
    );
  }

  const press = (selector: string, init: KeyboardEventInit) =>
    act(() => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        shiftKey: true,
        ...init,
      });
      host.querySelector(selector)?.dispatchEvent(event);
    });

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("calls for the panel a key opens", () => {
    press("[data-page-button]", { key: "M" });
    expect(onShortcut).toHaveBeenCalledWith("comments", expect.anything());
  });

  it("leaves a key the page has used, such as a comment on selected text", () => {
    host.addEventListener("keydown", (event) => event.preventDefault());
    press("[data-page-button]", { key: "M" });
    expect(onShortcut).not.toHaveBeenCalled();
  });

  it("reaches ⇧⌘I before an editor's italic does", () => {
    host.addEventListener("keydown", (event) => {
      if (!event.defaultPrevented) event.preventDefault();
    });
    press("[data-page-button]", { key: "I" });
    expect(onShortcut).toHaveBeenCalledTimes(1);
    expect(onShortcut.mock.calls[0]?.[0]).toBe("info");
  });

  it("leaves ⇧⌘M to dictation in the agent's box, and no other key", () => {
    press("[data-agent-box]", { key: "M" });
    expect(onShortcut).not.toHaveBeenCalled();

    press("[data-agent-box]", { key: "I" });
    expect(onShortcut).toHaveBeenCalledWith("info", expect.anything());
  });
});

describe("escapeWasHandled", () => {
  const handled = () => {
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    event.preventDefault();
    return event;
  };

  it("leaves a press nothing has used", () => {
    expect(escapeWasHandled(key({ key: "Escape" }))).toBe(false);
  });

  it("counts a press a menu has used", () => {
    expect(escapeWasHandled(handled())).toBe(true);
  });

  it("ignores a press left to the panel", () => {
    const event = handled();
    leaveEscapeToPagePanel(event);
    expect(escapeWasHandled(event)).toBe(false);
  });
});

describe("firstFocusableIn", () => {
  it("skips what cannot take focus", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<button disabled></button><span tabindex="-1"></span><input data-first /><button></button>';
    expect(firstFocusableIn(root)?.hasAttribute("data-first")).toBe(true);
    expect(firstFocusableIn(null)).toBeNull();
  });
});

describe("usePagePanelMotion", () => {
  let host: HTMLDivElement;
  let root: Root;
  let motion: ReturnType<typeof usePagePanelMotion>;
  let reducedMotion: boolean;

  function Probe({
    requested,
    margin,
  }: {
    requested: DocumentPagePanelTab | null;
    margin: boolean;
  }) {
    motion = usePagePanelMotion(requested, margin);
    return null;
  }

  const render = (requested: DocumentPagePanelTab | null, margin = false) =>
    act(() => root.render(<Probe requested={requested} margin={margin} />));

  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  beforeEach(() => {
    vi.useFakeTimers();
    reducedMotion = false;
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: reducedMotion && query.includes("reduce"),
        }) as MediaQueryList,
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("opens at once when no margin is on screen", () => {
    render(null);
    render("info");
    expect(motion).toMatchObject({
      tab: "info",
      rendered: "info",
      closing: false,
      marginFading: false,
    });
  });

  it("holds the panel until the margin comments have faded", () => {
    render(null, true);
    render("comments", true);
    expect(motion).toMatchObject({
      tab: null,
      marginFading: true,
      closing: false,
    });

    wait(PAGE_PANEL_MARGIN_FADE_MS);
    expect(motion).toMatchObject({ tab: "comments", marginFading: false });
  });

  it("switches tabs in the open panel without leaving or fading", () => {
    render("agent", false);
    render("info", true);
    expect(motion).toMatchObject({
      tab: "info",
      rendered: "info",
      closing: false,
      marginFading: false,
    });
  });

  it("keeps a closing panel drawn until it has slid away", () => {
    render("info");
    render(null);
    expect(motion).toMatchObject({
      tab: null,
      rendered: "info",
      closing: true,
    });

    wait(260);
    expect(motion).toMatchObject({
      tab: null,
      rendered: null,
      closing: false,
    });
  });

  it("switches at once for a reader who prefers reduced motion", () => {
    reducedMotion = true;
    render(null, true);
    render("comments", true);
    expect(motion).toMatchObject({ tab: "comments", marginFading: false });

    render(null, true);
    expect(motion).toMatchObject({
      tab: null,
      rendered: null,
      closing: false,
    });
  });
});
