// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  mountCount: 0,
  orgId: "org-a" as string | null,
  isLoading: false,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({
    data: { orgId: testState.orgId },
    isLoading: testState.isLoading,
  }),
}));

const markOrgSwitchUnmountSpy = vi.hoisted(() => vi.fn());

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
    markOrgSwitchUnmount: markOrgSwitchUnmountSpy,
  };
});

import { OrganizationScopedDeckProvider } from "./OrganizationScopedDeckProvider";

afterEach(() => {
  cleanup();
  testState.mountCount = 0;
  testState.orgId = "org-a";
  testState.isLoading = false;
  markOrgSwitchUnmountSpy.mockClear();
});

describe("OrganizationScopedDeckProvider", () => {
  it("renders nothing while org is loading", () => {
    testState.isLoading = true;
    render(
      <OrganizationScopedDeckProvider version={3}>
        <span>Decks</span>
      </OrganizationScopedDeckProvider>,
    );
    expect(screen.queryByTestId("deck-provider")).toBeNull();
  });

  it("mounts exactly once when org resolves from loading", () => {
    testState.isLoading = true;
    const { rerender } = render(
      <OrganizationScopedDeckProvider version={3}>
        <span>Decks</span>
      </OrganizationScopedDeckProvider>,
    );
    expect(testState.mountCount).toBe(0);

    testState.isLoading = false;
    rerender(
      <OrganizationScopedDeckProvider version={3}>
        <span>Decks</span>
      </OrganizationScopedDeckProvider>,
    );
    expect(testState.mountCount).toBe(1);
    expect(markOrgSwitchUnmountSpy).not.toHaveBeenCalled();
  });

  it("remounts DeckProvider when the active organization changes", () => {
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

  it("signals org-switch before the key changes so cleanup can cancel instead of flush", () => {
    const { rerender } = render(
      <OrganizationScopedDeckProvider version={3}>
        <span>Decks</span>
      </OrganizationScopedDeckProvider>,
    );
    expect(markOrgSwitchUnmountSpy).not.toHaveBeenCalled();

    testState.orgId = "org-b";
    rerender(
      <OrganizationScopedDeckProvider version={3}>
        <span>Decks</span>
      </OrganizationScopedDeckProvider>,
    );

    expect(markOrgSwitchUnmountSpy).toHaveBeenCalledTimes(1);
  });

  it("does not signal org-switch when re-rendering without an org change", () => {
    const { rerender } = render(
      <OrganizationScopedDeckProvider version={3}>
        <span>Decks</span>
      </OrganizationScopedDeckProvider>,
    );
    rerender(
      <OrganizationScopedDeckProvider version={3}>
        <span>Decks</span>
      </OrganizationScopedDeckProvider>,
    );
    expect(markOrgSwitchUnmountSpy).not.toHaveBeenCalled();
  });
});
