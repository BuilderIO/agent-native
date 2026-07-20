// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  mountCount: 0,
  orgId: "org-a" as string | null,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: testState.orgId } }),
}));

vi.mock("@/context/DeckContext", async () => {
  const React = await import("react");
  return {
    DeckProvider: ({ children }: { children: React.ReactNode }) => {
      const [mountId] = React.useState(() => ++testState.mountCount);
      return (
        <div data-testid="deck-provider" data-mount-id={mountId}>
          {children}
        </div>
      );
    },
  };
});

import { OrganizationScopedDeckProvider } from "./OrganizationScopedDeckProvider";

afterEach(() => {
  cleanup();
  testState.mountCount = 0;
  testState.orgId = "org-a";
});

describe("OrganizationScopedDeckProvider", () => {
  it("remounts deck state when the active organization changes", () => {
    const { rerender } = render(
      <OrganizationScopedDeckProvider version={3}>
        <span>Decks</span>
      </OrganizationScopedDeckProvider>,
    );
    const initialMountId = screen
      .getByTestId("deck-provider")
      .getAttribute("data-mount-id");

    testState.orgId = "org-b";
    rerender(
      <OrganizationScopedDeckProvider version={3}>
        <span>Decks</span>
      </OrganizationScopedDeckProvider>,
    );

    expect(
      screen.getByTestId("deck-provider").getAttribute("data-mount-id"),
    ).not.toBe(initialMountId);
  });
});
