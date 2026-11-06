// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
const refetch = vi.fn();
let role: string | undefined;
let links: { token: string; createdAt: string }[] = [];
let listFailed = false;

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (
    action: string,
    _params: unknown,
    options?: { enabled?: boolean },
  ) => {
    if (action === "list-resource-shares") return { data: { role } };
    if (options?.enabled === false) return { data: undefined, refetch };
    if (listFailed)
      return {
        data: links.length ? { links } : undefined,
        isError: true,
        isFetching: false,
        refetch,
      };
    return { data: { links }, refetch };
  },
  useActionMutation: () => ({ mutate, isPending: false }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { SnapshotShareLinks } from "./SnapshotShareLinks";

describe("SnapshotShareLinks", () => {
  afterEach(cleanup);

  beforeEach(() => {
    role = "owner";
    links = [];
    listFailed = false;
    refetch.mockReset();
  });

  it("renders nothing when the deck has no live snapshot links", () => {
    const { container } = render(<SnapshotShareLinks deckId="deck-1" />);
    expect(container.innerHTML).toBe("");
  });

  it("revokes the chosen snapshot link", () => {
    links = [
      { token: "tok-a", createdAt: "2026-11-01T00:00:00.000Z" },
      { token: "tok-b", createdAt: "2026-11-02T00:00:00.000Z" },
    ];
    render(<SnapshotShareLinks deckId="deck-1" />);

    const second = screen.getAllByRole("button").at(1);
    if (!second) throw new Error("expected two revoke buttons");
    fireEvent.click(second);

    expect(mutate).toHaveBeenCalledWith({ deckId: "deck-1", token: "tok-b" });
  });

  it("shows a retryable error to a manager when the links fail to load", () => {
    role = "admin";
    listFailed = true;
    render(<SnapshotShareLinks deckId="deck-1" />);

    expect(screen.getByRole("alert").textContent).toContain(
      "share.snapshotLinksLoadFailed",
    );
    fireEvent.click(screen.getByRole("button", { name: "settings.retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps loaded links revocable when a background refetch fails", () => {
    role = "owner";
    links = [{ token: "tok-a", createdAt: "2026-11-01T00:00:00.000Z" }];
    listFailed = true;
    render(<SnapshotShareLinks deckId="deck-1" />);

    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "share.revokeLink" }));
    expect(mutate).toHaveBeenCalledWith({ deckId: "deck-1", token: "tok-a" });
  });

  it("renders nothing for someone who cannot manage the deck", () => {
    role = "editor";
    listFailed = true;
    const { container } = render(<SnapshotShareLinks deckId="deck-1" />);
    expect(container.innerHTML).toBe("");
  });
});
