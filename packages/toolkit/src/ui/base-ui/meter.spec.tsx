// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Meter, MeterLabel, MeterValue } from "./meter.js";

afterEach(cleanup);

describe("Meter part", () => {
  it("writes its variant, surface by default, inheriting its color", () => {
    render(
      <Meter value={70}>
        <MeterLabel>Storage</MeterLabel>
        <MeterValue />
      </Meter>,
    );
    const meter = screen.getByRole("meter", { name: "Storage" });
    expect(meter.classList.contains("meter")).toBe(true);
    expect(meter.getAttribute("aria-valuenow")).toBe("70");
    expect(meter.querySelector(".meter-track .meter-indicator")).not.toBeNull();
    expect(meter.dataset.variant).toBe("surface");
    expect(meter.dataset.color).toBeUndefined();
  });

  it("writes color, high contrast and radius as Radix names them", () => {
    render(
      <Meter
        value={70}
        aria-label="Storage"
        variant="soft"
        color="warning"
        highContrast
        radius="small"
      />,
    );
    const meter = screen.getByRole("meter", { name: "Storage" });
    expect(meter.dataset.variant).toBe("soft");
    expect(meter.dataset.color).toBe("warning");
    expect(meter.dataset.highContrast).toBe("");
    expect(meter.dataset.radius).toBe("small");
  });
});
