// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Switch, type SwitchProps } from "./switch.js";

afterEach(cleanup);

describe("Switch part", () => {
  it("renders the part with Base UI's state attributes, size 3 surface by default", () => {
    render(<Switch aria-label="Sync" defaultChecked />);
    const control = screen.getByRole("switch", { name: "Sync" });
    expect(control.classList.contains("switch")).toBe(true);
    expect(control.dataset.size).toBe("3");
    expect(control.dataset.variant).toBe("surface");
    expect(control.dataset.color).toBeUndefined();
    expect(control.dataset.radius).toBeUndefined();
    expect(control.hasAttribute("data-checked")).toBe(true);
    expect(control.getAttribute("aria-checked")).toBe("true");
    const thumb = control.querySelector(".switch-thumb");
    expect(thumb?.hasAttribute("data-checked")).toBe(true);
  });

  it("toggles on click and reports the new state", () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch aria-label="Sync" size="1" onCheckedChange={onCheckedChange} />,
    );
    const control = screen.getByRole("switch", { name: "Sync" });
    expect(control.dataset.size).toBe("1");
    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
    expect(control.hasAttribute("data-checked")).toBe(true);
  });

  it("writes variant, color, high contrast and radius as Radix names them", () => {
    render(
      <Switch
        aria-label="Sync"
        size="3"
        variant="soft"
        color="success"
        highContrast
        radius="none"
      />,
    );
    const control = screen.getByRole("switch", { name: "Sync" });
    expect(control.dataset.size).toBe("3");
    expect(control.dataset.variant).toBe("soft");
    expect(control.dataset.color).toBe("success");
    expect(control.dataset.highContrast).toBe("");
    expect(control.dataset.radius).toBe("none");
  });

  it("refuses a size it doesn't have instead of drawing the default", () => {
    const props = { size: "md" } as unknown as SwitchProps;
    expect(() => render(<Switch aria-label="Sync" {...props} />)).toThrow(
      /size="md" is not one of/,
    );
  });

  it("toggles from a label pointed at its id", () => {
    function Labelled() {
      const [on, setOn] = React.useState(false);
      return (
        <>
          <label htmlFor="sync">Sync</label>
          <Switch id="sync" checked={on} onCheckedChange={setOn} />
        </>
      );
    }
    render(<Labelled />);
    fireEvent.click(screen.getByText("Sync"));
    expect(
      screen.getByRole("switch", { name: "Sync" }).hasAttribute("data-checked"),
    ).toBe(true);
  });

  it("does not toggle while disabled", () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch aria-label="Sync" disabled onCheckedChange={onCheckedChange} />,
    );
    const control = screen.getByRole("switch", { name: "Sync" });
    fireEvent.click(control);
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(control.hasAttribute("data-disabled")).toBe(true);
  });
});
