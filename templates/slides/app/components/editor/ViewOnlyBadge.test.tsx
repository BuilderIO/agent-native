// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { email: "viewer@example.com" } as { email: string } | null,
  requestAccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/hooks", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    useSession: () => ({ session: mocks.session }),
    useActionMutation: (name: string) =>
      useMutation({
        mutationFn: (variables: unknown) =>
          mocks.requestAccess(name, variables),
      }),
    useActionQuery: () => ({}),
  };
});

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

import { ViewOnlyBadge } from "./ViewOnlyBadge";

function renderBadge(canRequestEdit = true) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ViewOnlyBadge deckId="deck-1" canRequestEdit={canRequestEdit} />
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe("<ViewOnlyBadge>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { email: "viewer@example.com" };
    mocks.requestAccess.mockResolvedValue({
      ok: true,
      alreadyHasAccess: false,
      notifiedOwner: true,
      message: "Access request sent to the deck owner.",
    });
  });

  it("asks the owner for edit access, then shows it was requested", async () => {
    renderBadge();

    fireEvent.click(
      screen.getByRole("button", { name: "editorToolbar.requestEditAccess" }),
    );

    const requested = await screen.findByRole("button", {
      name: "editorToolbar.editAccessRequested",
    });
    expect(requested.hasAttribute("disabled")).toBe(true);
    expect(mocks.requestAccess).toHaveBeenCalledWith("request-deck-access", {
      deckId: "deck-1",
      role: "editor",
    });
  });

  it("reports a failed request and lets the viewer try again", async () => {
    mocks.requestAccess.mockRejectedValue(new Error("down"));
    renderBadge();

    fireEvent.click(
      screen.getByRole("button", { name: "editorToolbar.requestEditAccess" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "editorToolbar.editAccessRequestFailed",
      ),
    );
    expect(
      screen
        .getByRole("button", { name: "editorToolbar.requestEditAccess" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("offers no request to a signed-out viewer", () => {
    mocks.session = null;
    renderBadge();

    expect(screen.getByText("editorToolbar.viewOnly")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers no request where the embed cannot edit", () => {
    renderBadge(false);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
