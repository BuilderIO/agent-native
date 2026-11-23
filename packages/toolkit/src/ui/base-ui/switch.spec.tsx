// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Switch } from "./switch.js";

afterEach(cleanup);

describe("Switch part", () => {
  it("renders the part with Base UI's state attributes, surface by default", () => {
    render(<Switch aria-label="Sync" defaultChecked />);
    const control = screen.getByRole("switch", { name: "Sync" });
    expect(control.classList.contains("switch")).toBe(true);
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
    render(<Switch aria-label="Sync" onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole("switch", { name: "Sync" });
    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
    expect(control.hasAttribute("data-checked")).toBe(true);
  });

  it("writes variant, color, high contrast and radius as Radix names them", () => {
    render(
      <Switch
        aria-label="Sync"
        variant="soft"
        color="success"
        highContrast
        radius="none"
      />,
    );
    const control = screen.getByRole("switch", { name: "Sync" });
    expect(control.dataset.variant).toBe("soft");
    expect(control.dataset.color).toBe("success");
    expect(control.dataset.highContrast).toBe("");
    expect(control.dataset.radius).toBe("none");
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
