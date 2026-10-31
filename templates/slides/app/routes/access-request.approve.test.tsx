// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  review: {
    deckId: "deck-1",
    deckTitle: "Launch review",
    requesterEmail: "viewer@example.com",
    requesterName: null,
    note: null,
    requestedRole: "editor",
    granted: false,
  } as Record<string, unknown>,
  mutation: {} as Record<string, unknown>,
  mutate: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    values?.email ? `${key}:${values.email}` : key,
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appPath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/sign-in-return", () => ({
  buildSignInReturnHref: () => "/sign-in",
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({
    session: { email: "owner@example.com" },
    isLoading: false,
  }),
  useActionQuery: () => ({ data: mocks.review }),
  useActionMutation: () => ({ mutate: mocks.mutate, ...mocks.mutation }),
}));

import ApproveDeckAccessRequestRoute from "./access-request.approve";

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={["/access-request/approve?deckId=deck-1&token=tok"]}
    >
      <ApproveDeckAccessRequestRoute />
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

describe("approve deck access request page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutation = {};
    mocks.review = { ...mocks.review, requestedRole: "editor", granted: false };
  });

  it("waits for the owner, then grants the requested role", () => {
    renderPage();

    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "deckEditor.accessApprovalRequestedEdit:viewer@example.com",
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "deckEditor.accessApprovalAllow" }),
    );

    expect(mocks.mutate).toHaveBeenCalledWith(
      { deckId: "deck-1", approvalToken: "tok", role: "editor" },
      expect.any(Object),
    );
  });

  it("keeps the approval token out of the address bar", () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    renderPage();

    expect(replaceState).toHaveBeenCalled();
    expect(String(replaceState.mock.lastCall?.[2])).not.toContain("tok");
    replaceState.mockRestore();
  });

  it("names the granted role once access is allowed", () => {
    mocks.mutation = {
      data: {
        ok: true,
        alreadyAllowed: false,
        requesterEmail: "viewer@example.com",
        deckId: "deck-1",
        deckTitle: "Launch review",
        shareId: "share-1",
        role: "editor",
        requesterNotified: null,
        message: "Access granted.",
      },
    };
    renderPage();

    expect(
      screen.getByText(
        "deckEditor.accessApprovalEditorMessage:viewer@example.com",
      ),
    ).toBeTruthy();
  });
});
