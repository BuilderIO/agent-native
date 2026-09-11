// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SnackbarProvider, useSnackbar } from "./snackbar";

afterEach(() => {
  cleanup();
});

function CopyButton() {
  const show = useSnackbar();
  return (
    <button type="button" onClick={() => show("Copied")}>
      copy
    </button>
  );
}

function renderSnackbar() {
  return render(
    <SnackbarProvider>
      <CopyButton />
    </SnackbarProvider>,
  );
}

describe("SnackbarProvider", () => {
  // The pill has to escape core's `.agent-sidebar-main-surface`, which sets
  // `position: relative; z-index: 1` and `container-type: inline-size` around
  // all page content. Left inside it, no z-index can clear the dialog overlay.
  it("mounts the live region directly on body, not inside the provider tree", () => {
    const { container } = renderSnackbar();

    const region = screen.getByRole("status");

    expect(region.parentElement).toBe(document.body);
    expect(container.contains(region)).toBe(false);
  });

  it("keeps the brand token scope, which body is not inside", () => {
    renderSnackbar();

    expect(
      screen.getByRole("status").classList.contains("builder-brand-tokens"),
    ).toBe(true);
  });

  it("shows the message through the portal", () => {
    renderSnackbar();

    fireEvent.click(screen.getByRole("button", { name: "copy" }));

    const region = screen.getByRole("status");
    expect(region.textContent).toContain("Copied");
    expect(region.parentElement).toBe(document.body);
  });
});
