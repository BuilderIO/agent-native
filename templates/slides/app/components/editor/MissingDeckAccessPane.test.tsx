// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "deckEditor.lookingForDeck": "Looking for this deck",
      "deckEditor.privateDeckTitle": "You don't have access to this deck",
      "deckEditor.privateDeckDescription":
        "Request access and the owner will be notified.",
      "deckEditor.signedInAs": "You're signed in as",
      "deckEditor.requestAccess": "Request access",
      "deckEditor.signInToRequestAccess": "Sign in to request access",
      "deckEditor.accessRequestSent": "Request sent",
      "deckEditor.accessRequestSentDescription": "The owner has been notified.",
      "deckEditor.accessRequestRecordedDescription":
        "Your request has been recorded.",
      "deckEditor.requestAccessPending": "Sending request...",
      "deckEditor.requestAccessDialogTitle": "Request access",
      "deckEditor.requestAccessDialogDescription":
        "Sign in, or enter the email address the owner should share this deck with.",
      "deckEditor.requestAccessSignIn": "Sign in or sign up",
      "deckEditor.requestAccessOr": "or",
      "deckEditor.requestAccessEmailLabel": "Email address",
      "deckEditor.requestAccessEmailPlaceholder": "you@example.com",
      "deckEditor.requestAccessEmailHint":
        "After access is granted, sign in with this email to view the deck.",
      "deckEditor.requestAccessWithEmail": "Request with email",
      "deckEditor.requestAccessEmailRequired": "Enter a valid email address.",
      "deckEditor.requestingAccess": "Requesting access...",
      "deckEditor.accessRequestSentWithEmail":
        "The deck owner was asked to share this deck with {{email}}.",
      "deckEditor.accessRequestFailed": "Couldn't request access. Try again.",
      "deckEditor.backToDecks": "Back to Decks",
      "deckEditor.tryAgain": "Try again",
      "deckEditor.checkingSharedAccess": "Checking access",
      "deckEditor.joinTeamToOpen": "Join your team to open this deck",
      "deckEditor.joinTeamDescription": "Join your team.",
      "deckEditor.deckUnavailable": "Deck unavailable",
      "deckEditor.deckUnavailableDescription": "Deck unavailable.",
    })[key] ?? key,
}));

import { MissingDeckAccessPane } from "./MissingDeckAccessPane";

afterEach(() => cleanup());

function renderPane(
  overrides: Partial<React.ComponentProps<typeof MissingDeckAccessPane>> = {},
) {
  return render(
    <MissingDeckAccessPane
      accessStatus={null}
      accessStatusError={true}
      accessStatusLoading={false}
      hasTeamJoinOption={false}
      orgLoading={false}
      orgError={false}
      requestAccessPending={false}
      accessRequestSent={false}
      accessRequestNotified={false}
      requestAccessDialogOpen={false}
      requesterEmail=""
      requestAccessDialogError={null}
      signedIn={true}
      signInHref="/sign-in"
      viewerEmail="viewer@example.com"
      refreshing={false}
      onRequestAccess={vi.fn()}
      onRequestAccessDialogOpenChange={vi.fn()}
      onRequesterEmailChange={vi.fn()}
      onSubmitGuestAccessRequest={vi.fn()}
      onSignIn={vi.fn()}
      onRetry={vi.fn()}
      onBack={vi.fn()}
      {...overrides}
    />,
  );
}

describe("MissingDeckAccessPane", () => {
  it("turns an access-check error into the no-access request flow", () => {
    const onRequestAccess = vi.fn();
    renderPane({ onRequestAccess });

    expect(
      screen.getByRole("heading", {
        name: "You don't have access to this deck",
      }),
    ).toBeTruthy();
    expect(screen.queryByText(/couldn't check/i)).toBeNull();
    expect(screen.getByText("You're signed in as")).toBeTruthy();
    expect(screen.getByText("viewer@example.com")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Request access" }));
    expect(onRequestAccess).toHaveBeenCalledOnce();
  });

  it("keeps Login primary and Request access secondary when signed out", () => {
    const onSignIn = vi.fn();
    const onRequestAccess = vi.fn();
    const onRequestAccessDialogOpenChange = vi.fn();
    renderPane({
      signedIn: false,
      viewerEmail: null,
      onSignIn,
      onRequestAccess,
      onRequestAccessDialogOpenChange,
    });

    const signInButton = screen.getByRole("button", {
      name: "Sign in to request access",
    });
    const requestButton = screen.getByRole("button", {
      name: "Request access",
    });
    expect(signInButton).toBeTruthy();
    expect(requestButton).toBeTruthy();

    fireEvent.click(signInButton);
    fireEvent.click(requestButton);
    expect(onSignIn).toHaveBeenCalledOnce();
    expect(onRequestAccessDialogOpenChange).toHaveBeenCalledWith(true);
    expect(onRequestAccess).not.toHaveBeenCalled();
  });

  it("keeps the guest CTA visible when a failed access check needs a refresh", () => {
    const onRequestAccessDialogOpenChange = vi.fn();
    renderPane({
      signedIn: false,
      viewerEmail: null,
      onRequestAccessDialogOpenChange,
    });

    expect(
      screen.getByRole("button", { name: "Sign in to request access" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Request access" }));
    expect(onRequestAccessDialogOpenChange).toHaveBeenCalledWith(true);
  });

  it("opens the guest request form from the signed-out secondary action", () => {
    const onSubmitGuestAccessRequest = vi.fn((event) => event.preventDefault());
    renderPane({
      accessStatus: {
        exists: true,
        hasAccess: false,
        signedIn: false,
        viewerEmail: null,
        viewerName: null,
        role: null,
        visibility: "private",
        accessRequestToken: "fallback-request-token",
      },
      accessStatusError: false,
      signedIn: false,
      viewerEmail: null,
      requestAccessDialogOpen: true,
      onSubmitGuestAccessRequest,
    });

    const email = screen.getByLabelText("Email address");
    fireEvent.change(email, { target: { value: "guest@example.com" } });
    const form = screen
      .getByRole("button", { name: "Request with email" })
      .closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form!);
    expect(onSubmitGuestAccessRequest).toHaveBeenCalledOnce();
  });

  it("shows the durable sent state instead of another request action", () => {
    renderPane({ accessRequestSent: true, accessRequestNotified: true });

    expect(
      (
        screen.getByRole("button", {
          name: "Request sent",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText("The owner has been notified.")).toBeTruthy();
  });
});
