// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TabNav, TabNavLink, type TabNavProps } from "./tab-nav.js";

afterEach(cleanup);

function Example(props: TabNavProps) {
  return (
    <TabNav aria-label="Project" {...props}>
      <TabNavLink href="/overview" active>
        Overview
      </TabNavLink>
      <TabNavLink href="/activity">Activity</TabNavLink>
      <TabNavLink href="/settings">Settings</TabNavLink>
    </TabNav>
  );
}

describe("Tab Nav part", () => {
  it("renders a nav of links in a list, with the part classes", () => {
    render(<Example />);
    const nav = screen.getByRole("navigation", { name: "Project" });
    expect(nav.classList.contains("tab-nav")).toBe(true);
    const list = nav.querySelector("ul");
    expect(list?.classList.contains("tab-nav-list")).toBe(true);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.classList.contains("tab-nav-link")).toBe(true);
      expect(link.parentElement?.classList.contains("tab-nav-item")).toBe(true);
    }
  });

  it("marks the active link as the current page, and only it", () => {
    render(<Example />);
    const overview = screen.getByRole("link", { name: "Overview" });
    expect(overview.getAttribute("aria-current")).toBe("page");
    expect(overview.getAttribute("href")).toBe("/overview");
    for (const name of ["Activity", "Settings"]) {
      expect(
        screen.getByRole("link", { name }).hasAttribute("aria-current"),
      ).toBe(false);
    }
  });

  it("writes justify and wrap on the list, inheriting its color", () => {
    render(<Example />);
    const list = screen.getByRole("navigation").querySelector("ul");
    expect(list?.dataset.justify).toBe("start");
    expect(list?.dataset.wrap).toBe("nowrap");
    expect(list?.dataset.color).toBeUndefined();
    expect(list?.dataset.highContrast).toBeUndefined();
  });

  it("writes color and high contrast on the list as Radix names them", () => {
    render(<Example color="gray" highContrast justify="center" wrap="wrap" />);
    const nav = screen.getByRole("navigation");
    expect(nav.dataset.size).toBeUndefined();
    const list = nav.querySelector("ul");
    expect(list?.dataset.color).toBe("gray");
    expect(list?.dataset.highContrast).toBe("");
    expect(list?.dataset.justify).toBe("center");
    expect(list?.dataset.wrap).toBe("wrap");
  });

  it("moves between links with the arrow keys", async () => {
    render(<Example />);
    const overview = screen.getByRole("link", { name: "Overview" });
    const activity = screen.getByRole("link", { name: "Activity" });
    act(() => overview.focus());
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(activity));
  });
});
