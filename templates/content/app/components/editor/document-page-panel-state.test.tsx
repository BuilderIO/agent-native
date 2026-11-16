// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type DocumentPagePanelTab,
  escapeWasHandled,
  firstFocusableIn,
  keepFocusInPagePanel,
  PAGE_PANEL_MARGIN_FADE_MS,
  pagePanelShortcut,
  leaveEscapeToPagePanel,
  pagePanelEscapeCloses,
  returnFocusFromPagePanel,
  sendPagePanelAgentCommand,
  usePagePanelMotion,
  usePagePanelShortcuts,
} from "./document-page-panel-state";

const widget = vi.hoisted(() => ({ embedded: false }));
vi.mock("@agent-native/core/client/mcp-app-host", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/mcp-app-host")
  >()),
  useIsMcpAppWidgetEmbed: () => widget.embedded,
}));

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
    usePagePanelShortcuts(onShortcut);
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
    widget.embedded = false;
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

  it("gives a widget, which shows no tabs, none of the keys", () => {
    act(() => root.unmount());
    widget.embedded = true;
    root = createRoot(host);
    act(() => root.render(<Probe />));

    press("[data-page-button]", { key: "I" });
    press("[data-page-button]", { key: "M" });
    press("[data-page-button]", {
      key: "\\",
      code: "Backslash",
      shiftKey: false,
    });
    expect(onShortcut).not.toHaveBeenCalled();
  });
});

describe("sendPagePanelAgentCommand", () => {
  const opened = vi.fn();
  const closed = vi.fn();

  beforeEach(() => {
    window.addEventListener("agent-panel:open", opened);
    window.addEventListener("agent-panel:close", closed);
  });

  afterEach(() => {
    window.removeEventListener("agent-panel:open", opened);
    window.removeEventListener("agent-panel:close", closed);
    vi.clearAllMocks();
  });

  it("opens the agent, with focus when a key asked for it", () => {
    expect(
      sendPagePanelAgentCommand("agent", { ownsAgent: true, focus: true }),
    ).toBe(true);
    expect((opened.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      focus: true,
    });
  });

  it("closes the agent along with the panel of the page that owns it", () => {
    expect(
      sendPagePanelAgentCommand(null, { ownsAgent: true, focus: false }),
    ).toBe(false);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("leaves the page's agent open when a row preview's panel closes", () => {
    sendPagePanelAgentCommand(null, { ownsAgent: false, focus: false });
    expect(closed).not.toHaveBeenCalled();
  });

  it("leaves Discussion and Info to the page", () => {
    expect(
      sendPagePanelAgentCommand("info", { ownsAgent: true, focus: false }),
    ).toBe(false);
    expect(opened).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });
});

describe("returnFocusFromPagePanel", () => {
  let host: HTMLDivElement;
  let panel: HTMLDivElement;
  let opener: HTMLButtonElement;
  let tab: HTMLButtonElement;
  let fallback: HTMLButtonElement;

  beforeEach(() => {
    host = document.createElement("div");
    host.innerHTML = `
      <button data-opener></button>
      <button data-tab></button>
      <button data-fallback></button>
      <button data-elsewhere></button>
      <div data-panel><button data-inside></button></div>`;
    document.body.append(host);
    const get = <T extends HTMLElement>(selector: string) => {
      const element = host.querySelector<T>(selector);
      if (!element) throw new Error(`No ${selector}`);
      return element;
    };
    panel = get("[data-panel]");
    opener = get("[data-opener]");
    tab = get("[data-tab]");
    fallback = get("[data-fallback]");
    get("[data-inside]").focus();
  });

  afterEach(() => host.remove());

  it("goes back to where focus was before the panel opened", () => {
    returnFocusFromPagePanel({ panel, target: opener, tab, fallback });
    expect(document.activeElement).toBe(opener);
  });

  it("goes to the open section's tab when that place has gone", () => {
    opener.remove();
    returnFocusFromPagePanel({ panel, target: opener, tab, fallback });
    expect(document.activeElement).toBe(tab);
  });

  it("goes to the fallback with no tab to go to", () => {
    returnFocusFromPagePanel({ panel, target: null, tab: null, fallback });
    expect(document.activeElement).toBe(fallback);
  });

  it("leaves focus that has moved on out of the panel", () => {
    const elsewhere = host.querySelector<HTMLElement>("[data-elsewhere]");
    elsewhere?.focus();
    returnFocusFromPagePanel({ panel, target: opener, tab, fallback });
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe("keepFocusInPagePanel", () => {
  let host: HTMLDivElement;
  let heading: HTMLHeadingElement;
  let box: HTMLButtonElement;
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    host.innerHTML = `<h2 tabindex="-1">Agent</h2><button>Message agent</button>`;
    document.body.append(host);
    const h2 = host.querySelector("h2");
    const button = host.querySelector("button");
    if (!h2 || !button) throw new Error("No panel");
    heading = h2;
    box = button;
    box.focus();
    stop = keepFocusInPagePanel(() => heading);
  });

  afterEach(() => {
    stop();
    host.remove();
    vi.useRealTimers();
  });

  it("gives the heading focus that the agent's box drops", () => {
    box.remove();
    vi.advanceTimersByTime(100);
    expect(document.activeElement).toBe(heading);
  });

  it("leaves focus that is still somewhere", () => {
    vi.advanceTimersByTime(300);
    expect(document.activeElement).toBe(box);
  });

  it("stops at a click, so a click away from the panel keeps its focus", () => {
    document.dispatchEvent(new PointerEvent("pointerdown"));
    box.remove();
    vi.advanceTimersByTime(300);
    expect(document.activeElement).toBe(document.body);
  });

  it("stops after a while", () => {
    vi.advanceTimersByTime(5000);
    box.remove();
    vi.advanceTimersByTime(300);
    expect(document.activeElement).toBe(document.body);
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

  const wait = (ms: number) => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };

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

describe("pagePanelEscapeCloses", () => {
  const press = (
    tab: DocumentPagePanelTab | null,
    { replyOpen = false, commentCardOpen = false } = {},
  ) => pagePanelEscapeCloses({ tab, replyOpen, commentCardOpen });

  it("closes an open panel with nothing inside it open", () => {
    expect(press("info")).toBe(true);
    expect(press("comments")).toBe(true);
    expect(press("agent")).toBe(true);
  });

  it("has no panel to close when none is open", () => {
    expect(press(null)).toBe(false);
  });

  it("lets an open reply box in Discussion go first", () => {
    expect(press("comments", { replyOpen: true })).toBe(false);
  });

  it("closes Info past a reply left open, unseen, in Discussion", () => {
    expect(press("info", { replyOpen: true })).toBe(true);
    expect(press("agent", { replyOpen: true })).toBe(true);
  });

  it("lets a comment card on the page go first", () => {
    expect(press("comments", { commentCardOpen: true })).toBe(false);
  });
});
