// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

afterEach(() => cleanup());
import { MemoryRouter } from "react-router";
import type { ReactNode } from "react";

vi.mock("@agent-native/core", () => ({
  cn: (...args: unknown[]) =>
    args
      .flat(Infinity)
      .filter((v) => typeof v === "string" && v.length > 0)
      .join(" "),
}));
vi.mock("@agent-native/core/client/tools", () => ({
  ToolsSidebarSection: () => null,
}));
vi.mock("@agent-native/core/client", () => ({
  FeedbackButton: () => null,
}));

import { Sidebar } from "./Sidebar";

function renderAt(path: string, ui: ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe("<Sidebar collapsed>", () => {
  it("renders the icon-only rail (w-12) with an Expand button", () => {
    const onToggle = vi.fn();
    renderAt("/", <Sidebar collapsed={true} onToggleCollapsed={onToggle} />);

    const aside = screen.getByRole("complementary");
    expect(aside.className).toContain("w-12");

    const expandBtn = screen.getByTitle("Expand sidebar");
    expect(expandBtn).toBeDefined();
    expandBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    expect(screen.queryByText("Slides")).toBeNull();
    expect(screen.queryByTitle("Collapse sidebar")).toBeNull();
  });

  it("hides nav labels but keeps each nav item as a clickable icon with a tooltip", () => {
    renderAt("/", <Sidebar collapsed={true} onToggleCollapsed={() => {}} />);
    expect(screen.queryByText("Decks")).toBeNull();
    expect(screen.queryByText("Design Systems")).toBeNull();
    expect(screen.queryByText("Team")).toBeNull();

    expect(screen.getByTitle("Decks")).toBeDefined();
    expect(screen.getByTitle("Design Systems")).toBeDefined();
    expect(screen.getByTitle("Team")).toBeDefined();
  });
});

describe("<Sidebar expanded>", () => {
  it("renders the full sidebar (w-56) with the Collapse button and labelled nav", () => {
    const onToggle = vi.fn();
    renderAt("/", <Sidebar collapsed={false} onToggleCollapsed={onToggle} />);

    const aside = screen.getByRole("complementary");
    expect(aside.className).toContain("w-56");

    expect(screen.getByText("Slides")).toBeDefined();
    expect(screen.getByText("Decks")).toBeDefined();
    expect(screen.getByText("Design Systems")).toBeDefined();
    expect(screen.getByText("Team")).toBeDefined();

    const collapseBtn = screen.getByTitle("Collapse sidebar");
    collapseBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    expect(screen.queryByTitle("Expand sidebar")).toBeNull();
  });

  it("highlights the active nav item based on the current route", () => {
    renderAt(
      "/design-systems",
      <Sidebar collapsed={false} onToggleCollapsed={() => {}} />,
    );

    const designSystems = screen.getByText("Design Systems").closest("a")!;
    const decks = screen.getByText("Decks").closest("a")!;

    expect(designSystems.classList.contains("bg-sidebar-accent")).toBe(true);
    expect(decks.classList.contains("bg-sidebar-accent")).toBe(false);
  });
});

describe("<Sidebar> without onToggleCollapsed (mobile drawer)", () => {
  it("hides the Collapse button in the expanded layout", () => {
    renderAt("/", <Sidebar collapsed={false} />);
    expect(screen.queryByTitle("Collapse sidebar")).toBeNull();
    // Nav still renders.
    expect(screen.getByText("Decks")).toBeDefined();
  });

  it("hides the Expand button in the collapsed layout", () => {
    renderAt("/", <Sidebar collapsed={true} />);
    expect(screen.queryByTitle("Expand sidebar")).toBeNull();
    // Nav icons still render.
    expect(screen.getByTitle("Decks")).toBeDefined();
  });
});

describe("<Sidebar> accessibility", () => {
  it("gives icon-only controls aria-labels", () => {
    renderAt("/", <Sidebar collapsed={true} onToggleCollapsed={() => {}} />);
    expect(screen.getByLabelText("Expand sidebar")).toBeDefined();
    expect(screen.getByLabelText("Decks")).toBeDefined();
    expect(screen.getByLabelText("Design Systems")).toBeDefined();
    expect(screen.getByLabelText("Team")).toBeDefined();
  });

  it("labels the Collapse button in the expanded layout", () => {
    renderAt("/", <Sidebar collapsed={false} onToggleCollapsed={() => {}} />);
    expect(screen.getByLabelText("Collapse sidebar")).toBeDefined();
  });
});
