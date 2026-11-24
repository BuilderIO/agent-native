// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Tabs, TabsList, TabsPanel, TabsTab } from "./tabs.js";

afterEach(cleanup);

function Example(props: {
  onValueChange?: (value: unknown) => void;
  activateOnFocus?: boolean;
}) {
  return (
    <Tabs defaultValue="code" onValueChange={props.onValueChange}>
      <TabsList aria-label="View" activateOnFocus={props.activateOnFocus}>
        <TabsTab value="code">Code</TabsTab>
        <TabsTab value="preview">Preview</TabsTab>
        <TabsTab value="logs" disabled>
          Logs
        </TabsTab>
      </TabsList>
      <TabsPanel value="code">Source</TabsPanel>
      <TabsPanel value="preview">Rendered</TabsPanel>
    </Tabs>
  );
}

describe("Tabs part", () => {
  it("renders the part classes with Base UI's state attributes", () => {
    render(<Example />);
    expect(screen.getByRole("tablist").classList.contains("tabs-list")).toBe(
      true,
    );
    const code = screen.getByRole("tab", { name: "Code" });
    expect(code.classList.contains("tabs-tab")).toBe(true);
    expect(code.hasAttribute("data-active")).toBe(true);
    expect(code.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.getByRole("tab", { name: "Preview" }).hasAttribute("data-active"),
    ).toBe(false);
    expect(
      screen.getByRole("tab", { name: "Logs" }).hasAttribute("data-disabled"),
    ).toBe(true);
    const panel = screen.getByRole("tabpanel");
    expect(panel.classList.contains("tabs-panel")).toBe(true);
    expect(panel.textContent).toBe("Source");
  });

  it("writes the list's justify and wrap, inheriting its color", () => {
    render(<Example />);
    const list = screen.getByRole("tablist");
    expect(list.dataset.justify).toBe("start");
    expect(list.dataset.wrap).toBe("nowrap");
    expect(list.dataset.color).toBeUndefined();
    expect(list.dataset.highContrast).toBeUndefined();
  });

  it("writes color and high contrast on the list as Radix names them", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList color="gray" highContrast justify="center" wrap="wrap">
          <TabsTab value="a">A</TabsTab>
        </TabsList>
      </Tabs>,
    );
    const list = screen.getByRole("tablist");
    expect(list.dataset.color).toBe("gray");
    expect(list.dataset.highContrast).toBe("");
    expect(list.dataset.justify).toBe("center");
    expect(list.dataset.wrap).toBe("wrap");
  });

  it("underlines the active tab with Base UI's indicator", () => {
    render(<Example />);
    const indicator = screen
      .getByRole("tablist")
      .querySelector(".tabs-indicator");
    expect(indicator).not.toBeNull();
  });

  it("moves to the next tab with the arrow keys, and selects it when activateOnFocus", async () => {
    const onValueChange = vi.fn();
    render(<Example activateOnFocus onValueChange={onValueChange} />);
    const code = screen.getByRole("tab", { name: "Code" });
    const preview = screen.getByRole("tab", { name: "Preview" });
    act(() => code.focus());
    fireEvent.keyDown(code, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(preview));
    expect(onValueChange).toHaveBeenCalledWith("preview", expect.anything());
  });

  it("selects a tab on click and reports its value", () => {
    const onValueChange = vi.fn();
    render(<Example onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(onValueChange).toHaveBeenCalledWith("preview", expect.anything());
    expect(screen.getByRole("tabpanel").textContent).toBe("Rendered");
  });

  it("takes a state function for className, as Base UI does", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTab
            value="a"
            className={(state) => (state.active ? "is-on" : "is-off")}
          >
            A
          </TabsTab>
        </TabsList>
      </Tabs>,
    );
    const tab = screen.getByRole("tab", { name: "A" });
    expect(tab.className).toBe("tabs-tab is-on");
  });
});
