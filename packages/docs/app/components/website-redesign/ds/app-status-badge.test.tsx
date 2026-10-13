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

  it("renders the shadcn badge, inverted against the page surface", () => {
    render(<AppStatusBadge appId="slides" />);

    const badge = screen.getByText("alpha");
    expect(badge.dataset.slot).toBe("badge");
    expect(badge.className).toContain("bg-primary");
    expect(badge.className).toContain("text-primary-foreground");
    expect(badge.className).toContain("rounded-[6px]");
  });
});
