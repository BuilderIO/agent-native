// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
let links: { token: string; createdAt: string }[] = [];

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: { links }, refetch: vi.fn() }),
  useActionMutation: () => ({ mutate, isPending: false }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { SnapshotShareLinks } from "./SnapshotShareLinks";

describe("SnapshotShareLinks", () => {
  it("renders nothing when the deck has no live snapshot links", () => {
    links = [];
    const { container } = render(<SnapshotShareLinks deckId="deck-1" />);
    expect(container.innerHTML).toBe("");
  });

  it("revokes the chosen snapshot link", () => {
    links = [
      { token: "tok-a", createdAt: "2026-11-01T00:00:00.000Z" },
      { token: "tok-b", createdAt: "2026-11-02T00:00:00.000Z" },
    ];
    render(<SnapshotShareLinks deckId="deck-1" />);

    const [, second] = screen.getAllByRole("button");
    if (!second) throw new Error("expected two revoke buttons");
    fireEvent.click(second);

    expect(mutate).toHaveBeenCalledWith({ deckId: "deck-1", token: "tok-b" });
  });
});
