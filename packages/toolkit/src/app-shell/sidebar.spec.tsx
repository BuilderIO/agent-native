// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppSidebar,
  AppSidebarNavItem,
  AppSidebarNavGroup,
  AppSidebarSection,
  AppSidebarFeedbackButton,
} from "./sidebar.js";

describe("AppSidebar", () => {
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
  });

  it("renders expanded sidebar with brand, items, and utilities", () => {
    act(() => {
      root.render(
        <AppSidebar
          brandName="My App"
          brandHref="/home"
          badge={<span data-badge>alpha</span>}
          items={[
            { label: "Inbox", to: "/inbox", count: 5, active: true },
            { label: "Tasks", to: "/tasks" },
          ]}
          secondaryItems={[{ label: "Archive", to: "/archive" }]}
          feedback={<button type="button">Feedback</button>}
          orgSwitcher={<button type="button">Acme Org</button>}
        />,
      );
    });

    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside?.getAttribute("data-collapsed")).toBe("false");
    expect(aside?.className).toContain("w-[260px]");
    expect(container.textContent).toContain("My App");
    expect(container.textContent).toContain("alpha");
    expect(container.textContent).toContain("Inbox");
    expect(container.textContent).toContain("5");
    expect(container.textContent).toContain("Tasks");
    expect(container.textContent).toContain("Archive");
    expect(container.textContent).toContain("Feedback");
    expect(container.textContent).toContain("Acme Org");
  });

  it("renders collapsed sidebar with md:w-14 and tooltips", () => {
    act(() => {
      root.render(
        <AppSidebar
          collapsed
          brandName="My App"
          badge={<span data-badge>alpha</span>}
          items={[{ label: "Inbox", to: "/inbox" }]}
        />,
      );
    });

    const aside = container.querySelector("aside");
    expect(aside?.getAttribute("data-collapsed")).toBe("true");
    expect(aside?.className).toContain("md:w-14");
    // In collapsed mode, brand name is hidden from screen, badge is present
    expect(container.querySelector("[data-badge]")?.textContent).toBe("alpha");
  });

  it("toggles collapsed state via collapse button", () => {
    const onCollapsedChange = vi.fn();
    act(() => {
      root.render(
        <AppSidebar
          collapsed={false}
          onCollapsedChange={onCollapsedChange}
          brandName="My App"
        />,
      );
    });

    const collapseButton = container.querySelector(
      'button[aria-label="Collapse sidebar"]',
    );
    expect(collapseButton).not.toBeNull();

    act(() => {
      collapseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("renders collapsible nav group and expands/collapses children", () => {
    act(() => {
      root.render(
        <AppSidebar brandName="My App">
          <AppSidebarNavGroup label="Projects" defaultOpen={false}>
            <div>Project Alpha</div>
          </AppSidebarNavGroup>
        </AppSidebar>,
      );
    });

    expect(container.textContent).toContain("Projects");
    const toggleButton = container.querySelector('button[aria-label="Expand"]');
    expect(toggleButton).not.toBeNull();

    act(() => {
      toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Project Alpha");
  });

  it("renders sections with uppercase headers and dividers", () => {
    act(() => {
      root.render(
        <AppSidebar brandName="My App">
          <AppSidebarSection title="Favorites">
            <AppSidebarNavItem label="Starred item" />
          </AppSidebarSection>
        </AppSidebar>,
      );
    });

    expect(container.textContent).toContain("Favorites");
    expect(container.textContent).toContain("Starred item");
  });
});
