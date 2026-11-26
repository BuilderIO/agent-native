// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Progress,
  ProgressLabel,
  type ProgressProps,
  ProgressValue,
} from "./progress.js";

afterEach(cleanup);

describe("Progress part", () => {
  it("writes its variant, surface by default, inheriting its color", () => {
    render(<Progress value={40} aria-label="Uploading" />);
    const bar = screen.getByRole("progressbar", { name: "Uploading" });
    expect(bar.dataset.variant).toBe("surface");
    expect(bar.dataset.color).toBeUndefined();
    expect(bar.dataset.radius).toBeUndefined();
  });

  it("writes color, high contrast and radius as Radix names them", () => {
    render(
      <Progress
        value={40}
        aria-label="Uploading"
        variant="soft"
        color="success"
        highContrast
        radius="none"
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Uploading" });
    expect(bar.dataset.variant).toBe("soft");
    expect(bar.dataset.color).toBe("success");
    expect(bar.dataset.highContrast).toBe("");
    expect(bar.dataset.radius).toBe("none");
  });

  it("refuses a variant it doesn't have instead of drawing the default", () => {
    const props = { variant: "classic" } as unknown as Pick<
      ProgressProps,
      "variant"
    >;
    expect(() =>
      render(<Progress value={40} aria-label="Uploading" {...props} />),
    ).toThrow(/variant="classic" is not one of/);
  });

  it("draws a determinate progress with its label and value", () => {
    render(
      <Progress value={40}>
        <ProgressLabel>Uploading</ProgressLabel>
        <ProgressValue />
      </Progress>,
    );
    const bar = screen.getByRole("progressbar", { name: "Uploading" });
    expect(bar.classList.contains("progress")).toBe(true);
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(
      bar.querySelector(".progress-track .progress-indicator"),
    ).not.toBeNull();
    expect(bar.hasAttribute("data-progressing")).toBe(true);
  });

  it("marks a null value indeterminate and fills it over its duration", () => {
    render(<Progress value={null} duration="3s" aria-label="Waiting" />);
    const bar = screen.getByRole("progressbar", { name: "Waiting" });
    expect(bar.hasAttribute("data-indeterminate")).toBe(true);
    expect(bar.hasAttribute("duration")).toBe(false);
    const track = bar.querySelector<HTMLElement>(".progress-track");
    expect(track?.style.getPropertyValue("--progress-duration")).toBe("3s");
  });
});
