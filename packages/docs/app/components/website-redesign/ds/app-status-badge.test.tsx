// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppStatusBadge } from "./app-status-badge";

afterEach(() => {
  cleanup();
});

describe("AppStatusBadge", () => {
  it("falls back to the shared status map for an app id", () => {
    render(<AppStatusBadge appId="clips" />);

    expect(screen.getByText("alpha")).toBeTruthy();
  });

  it("renders an explicit status without consulting the map", () => {
    render(<AppStatusBadge status="beta" />);

    expect(screen.getByText("beta")).toBeTruthy();
  });

  it("renders a rounded badge that inverts against the page surface", () => {
    render(<AppStatusBadge appId="slides" />);

    const className = screen.getByText("alpha").className;
    expect(className).toContain("rounded-[6px]");
    expect(className).toContain("bg-[var(--b-text-primary,var(--fg))]");
    expect(className).toContain("text-[var(--b-bg-page,var(--bg))]");
  });
});
