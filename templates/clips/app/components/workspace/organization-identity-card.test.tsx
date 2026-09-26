import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  org: undefined as { orgId: string | null } | undefined,
  orgLoading: false,
  orgError: false,
  orgFetching: false,
  actionCalls: [] as string[],
  actionParams: [] as unknown[],
  actionResult: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({ session: { email: "owner@example.com" } }),
  useActionQuery: (
    name: string,
    params?: unknown,
    options?: { enabled?: boolean },
  ) => {
    if (options?.enabled !== false) {
      state.actionCalls.push(name);
      state.actionParams.push(params);
    }
    return state.actionResult;
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({
    data: state.org,
    isLoading: state.orgLoading,
    isError: state.orgError,
    isFetching: state.orgFetching,
  }),
}));

vi.mock("@/components/workspace/branding-editor", () => ({
  BrandingEditor: ({ initialName }: { initialName: string }) => (
    <div data-testid="branding-editor">{initialName}</div>
  ),
}));

import { OrganizationIdentityCard } from "./organization-identity-card";

beforeEach(() => {
  state.org = undefined;
  state.orgLoading = false;
  state.orgError = false;
  state.orgFetching = false;
  state.actionCalls = [];
  state.actionParams = [];
  state.actionResult = { data: undefined, isPending: false, isError: false };
});

describe("OrganizationIdentityCard", () => {
  it("renders nothing and fires no org read after the only organization is deleted", () => {
    state.org = { orgId: null };
    state.actionResult = { data: undefined, isPending: true, isError: false };

    const markup = renderToStaticMarkup(<OrganizationIdentityCard />);

    expect(markup).toBe("");
    expect(state.actionCalls).toEqual([]);
  });

  it("reports a failed organization lookup instead of hiding the section", () => {
    // personal scope would silently hide an auth/network/backend failure.
    state.org = undefined;
    state.orgError = true;

    const markup = renderToStaticMarkup(<OrganizationIdentityCard />);

    expect(markup).toContain("organizationSettings.brandingLoadFailed");
    expect(state.actionCalls).toEqual([]);
  });

  it("still reports a genuine load failure while an organization is active", () => {
    state.org = { orgId: "org_1" };
    state.actionResult = { data: undefined, isPending: false, isError: true };

    const markup = renderToStaticMarkup(<OrganizationIdentityCard />);

    expect(markup).toContain("organizationSettings.brandingLoadFailed");
    expect(state.actionCalls).toEqual(["list-organization-state"]);
  });

  it("waits instead of flashing the error while the active org is still in flight", () => {
    state.org = { orgId: "org_deleted" };
    state.orgFetching = true;
    state.actionResult = { data: undefined, isPending: false, isError: true };

    const markup = renderToStaticMarkup(<OrganizationIdentityCard />);

    expect(markup).not.toContain("organizationSettings.brandingLoadFailed");
    expect(markup).toContain("skeleton");
  });

  it("scopes the branding request to the active organization", () => {
    state.org = { orgId: "org_2" };
    state.actionResult = { data: undefined, isPending: true, isError: false };

    renderToStaticMarkup(<OrganizationIdentityCard />);

    expect(state.actionParams).toEqual([{ organizationId: "org_2" }]);
  });

  it("renders the editor for an admin of an active organization", () => {
    state.org = { orgId: "org_1" };
    state.actionResult = {
      data: {
        organization: {
          id: "org_1",
          name: "Acme",
          brandColor: "#18181B",
          brandLogoUrl: null,
          defaultVisibility: "public",
          ownerEmail: "owner@example.com",
        },
        members: [{ email: "owner@example.com", role: "owner" }],
      },
      isPending: false,
      isError: false,
    };

    const markup = renderToStaticMarkup(<OrganizationIdentityCard />);

    expect(markup).toContain("Acme");
  });
});
