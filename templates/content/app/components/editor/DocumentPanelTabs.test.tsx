// @vitest-environment happy-dom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`,
}));

import { DocumentPanelTabs } from "./DocumentPanelTabs";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("DocumentPanelTabs", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onTabChange = vi.fn();

  function render(
    props: Partial<ComponentProps<typeof DocumentPanelTabs>> = {},
  ) {
    act(() =>
      root.render(
        <TooltipProvider>
          <DocumentPanelTabs
            tabs={["agent", "comments", "info"]}
            activeTab={null}
            onTabChange={onTabChange}
            {...props}
          />
          <section id="document-page-panel">
            <button type="button" data-in-panel />
          </section>
        </TooltipProvider>,
      ),
    );
  }

  const tab = (name: string) => {
    const button = host.querySelector<HTMLButtonElement>(
      `[data-document-panel-tab="${name}"]`,
    );
    if (!button) throw new Error(`No ${name} tab`);
    return button;
  };

  const press = (element: HTMLElement, key: string) =>
    act(() => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("marks the open tab and is one stop for Tab", () => {
    render({ activeTab: "comments" });

    expect(tab("comments").getAttribute("aria-selected")).toBe("true");
    expect(tab("agent").getAttribute("aria-selected")).toBe("false");
    expect(tab("comments").tabIndex).toBe(0);
    expect(tab("agent").tabIndex).toBe(-1);
    expect(tab("info").tabIndex).toBe(-1);

    render();
    expect(tab("agent").tabIndex).toBe(0);
  });

  it("opens a tab on a click, and closes the open one", () => {
    render();
    act(() => tab("info").click());
    expect(onTabChange).toHaveBeenLastCalledWith("info");

    render({ activeTab: "info" });
    act(() => tab("info").click());
    expect(onTabChange).toHaveBeenLastCalledWith(null);
  });

  it("moves between tabs with the arrow keys, without opening one", () => {
    render();
    tab("agent").focus();

    press(tab("agent"), "ArrowRight");
    expect(document.activeElement).toBe(tab("comments"));
    press(tab("comments"), "End");
    expect(document.activeElement).toBe(tab("info"));
    press(tab("info"), "ArrowRight");
    expect(document.activeElement).toBe(tab("agent"));
    press(tab("agent"), "ArrowLeft");
    expect(document.activeElement).toBe(tab("info"));
    press(tab("info"), "Home");
    expect(document.activeElement).toBe(tab("agent"));
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it("goes from the open tab into its panel on Tab", () => {
    render({ activeTab: "comments" });
    tab("comments").focus();

    press(tab("comments"), "Tab");
    expect(document.activeElement).toBe(host.querySelector("[data-in-panel]"));
  });

  it("leaves Tab to the browser while the panel can't take focus yet", () => {
    render({ activeTab: "comments" });
    const inPanel = host.querySelector<HTMLButtonElement>("[data-in-panel]");
    if (!inPanel) throw new Error("No panel button");
    // An inert panel, mid-fade, refuses focus.
    inPanel.focus = () => {};
    tab("comments").focus();

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      tab("comments").dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(tab("comments"));
  });

  describe("tooltip", () => {
    const tooltip = () => document.querySelector('[role="tooltip"]');
    const pointer = (element: HTMLElement, type: string) =>
      act(() => {
        element.dispatchEvent(new PointerEvent(type, { bubbles: true }));
      });

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const hoverFor = (element: HTMLElement, ms: number) => {
      pointer(element, "pointerover");
      pointer(element, "pointermove");
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    };

    it("waits half a second on a pointer", () => {
      render();
      hoverFor(tab("info"), 400);
      expect(tooltip()).toBeNull();

      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(tooltip()?.textContent).toContain("editor.toolbar.info");
    });

    it("stays hidden on a tab that was just clicked", () => {
      render();
      pointer(tab("info"), "pointerover");
      pointer(tab("info"), "pointermove");
      pointer(tab("info"), "pointerdown");
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(tooltip()).toBeNull();
    });
  });

  it("draws the open comment count inside the Discussion tab", () => {
    render({ openCommentCount: 4 });
    expect(tab("comments").textContent).toBe("4");
    expect(tab("comments").getAttribute("aria-label")).toBe(
      "comments.discussionOpenCount:4",
    );

    render({ openCommentCount: 120 });
    expect(tab("comments").textContent).toBe("99+");

    render();
    expect(tab("comments").textContent).toBe("");
    expect(tab("comments").getAttribute("aria-label")).toBe(
      "comments.discussion",
    );
  });

  it("names each tab's key for assistive tech on this platform", () => {
    render();
    expect(tab("agent").getAttribute("aria-keyshortcuts")).toMatch(
      /^(Meta|Control)\+Shift\+J$/,
    );
    expect(tab("comments").getAttribute("aria-keyshortcuts")).toMatch(
      /^(Meta|Control)\+Shift\+M$/,
    );
    expect(tab("info").getAttribute("aria-keyshortcuts")).toMatch(
      /^(Meta|Control)\+Shift\+I$/,
    );
  });

  it("gives a phone plain 44 px buttons", () => {
    render({ plain: true });
    expect(tab("agent").className).toContain("h-11");
    expect(tab("agent").className).toContain("min-w-11");
    expect(host.querySelector("[role=tablist]")?.className).not.toContain(
      "bg-muted",
    );
  });
});
