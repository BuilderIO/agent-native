// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => {
    const value = key
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown>)?.[part],
        enUS,
      );
    return typeof value === "string" ? value : key;
  },
}));

vi.mock("@agent-native/core/client/ui", () => ({
  AgentNativeIcon: () => <svg data-testid="agent-native-icon" />,
}));

import { DeckAccessDeniedPage } from "./DeckAccessDeniedPage";

afterEach(() => cleanup());

function renderPage(
  overrides: Partial<React.ComponentProps<typeof DeckAccessDeniedPage>> = {},
) {
  return render(
    <DeckAccessDeniedPage
      canRequestAccess={true}
      request={{ status: "idle" }}
      savedNote={null}
      viewerEmail="viewer@example.com"
      onNoteChange={vi.fn()}
      onRequestAccess={vi.fn()}
      onSwitchAccount={vi.fn()}
      onGoHome={vi.fn()}
      {...overrides}
    />,
  );
}

const noteField = () =>
  screen.getByLabelText(
    "Add a note for the owner (optional)",
  ) as HTMLTextAreaElement;

describe("DeckAccessDeniedPage", () => {
  it("lets a viewer add a note and request access to a private deck", () => {
    const onRequestAccess = vi.fn();
    const onNoteChange = vi.fn();
    renderPage({ onRequestAccess, onNoteChange });

    expect(screen.getByText("Error 403")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "You don't have access" }),
    ).toBeTruthy();
    fireEvent.change(noteField(), { target: { value: "Launch review" } });
    expect(onNoteChange).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Request access" }));
    expect(onRequestAccess).toHaveBeenCalledWith("Launch review");
  });

  it("shows the signed-in account with switch account and go home", () => {
    const onSwitchAccount = vi.fn();
    const onGoHome = vi.fn();
    renderPage({ onSwitchAccount, onGoHome });

    expect(screen.getByText("viewer@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
    expect(onSwitchAccount).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Go home" }));
    expect(onGoHome).toHaveBeenCalledOnce();
  });

  it("locks the form while the request is in flight", () => {
    renderPage({ request: { status: "pending" } });

    expect(
      (screen.getByRole("button", { name: "Requesting" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(noteField().disabled).toBe(true);
  });

  it("confirms a sent request", () => {
    renderPage({
      request: { status: "sent", ownerNotified: true },
      savedNote: "Launch review",
    });

    expect(
      screen.getByText(
        "We’ll email you as soon as the owner approves your request.",
      ),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Request sent",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(noteField().value).toBe("Launch review");
  });

  it("shows an inline error and allows a retry when the request fails", () => {
    renderPage({ request: { status: "failed" } });

    expect(screen.getByRole("alert").textContent).toContain(
      "Your request wasn't sent. Please try again.",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Request access",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("hides the request form for decks that are not private", () => {
    renderPage({ canRequestAccess: false });

    expect(screen.queryByRole("button", { name: "Request access" })).toBeNull();
    expect(
      screen.queryByLabelText("Add a note for the owner (optional)"),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Go home" })).toBeTruthy();
  });
});
