// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrgInfo } from "../../../org/types.js";

const mocks = vi.hoisted(() => {
  const mutation = () => ({
    error: null,
    isPending: false,
    mutate: vi.fn(),
    reset: vi.fn(),
  });
  return {
    org: null as unknown,
    header: vi.fn(),
    navigate: vi.fn(),
    changeRole: mutation(),
    removeMember: mutation(),
    updateOrg: mutation(),
    deleteOrg: mutation(),
    setVisualIdentity: mutation(),
    members: [] as Array<{ email: string; role: string; name?: string }>,
  };
});

const ENGLISH: Record<string, string> = {
  "agentChat.settingsOrg.auth.methodsEmailOnly": "Email and password.",
  "agentChat.settingsOrg.auth.methodsEmailAndOne":
    "Email and password, and {{method}}.",
  "agentChat.settingsOrg.auth.methodsEmailAndTwo":
    "Email and password, {{first}}, and {{second}}.",
  "agentChat.settingsOrg.members.roleFor": "Role for {{name}}",
  "agentChat.settingsOrg.members.moreActions": "More actions for {{name}}",
  "agentChat.settingsOrg.auth.view": "View",
};

vi.mock("../../i18n.js", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    (ENGLISH[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(options?.[name] ?? ""),
    ),
}));

vi.mock("../hooks.js", () => ({
  useOrg: () => ({
    data: mocks.org,
    isLoading: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useOrgMembers: () => ({
    data: {
      members: mocks.members,
      totalCount: mocks.members.length,
      hasMore: false,
      nextOffset: null,
    },
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useOrgInvitations: () => ({ data: { invitations: [] } }),
  useAppRoles: () => ({ data: undefined }),
  useChangeMemberRole: () => mocks.changeRole,
  useRemoveMember: () => mocks.removeMember,
  useUpdateOrg: () => mocks.updateOrg,
  useDeleteOrg: () => mocks.deleteOrg,
  useSetOrgVisualIdentity: () => mocks.setVisualIdentity,
}));

vi.mock("../../settings/shell/context.js", () => ({
  useSettingsShell: () => ({ navigate: mocks.navigate }),
  useSettingsPageHeader: (header: unknown) => mocks.header(header),
}));

vi.mock("../OrgIdentitySettings.js", () => ({
  OrgIdentitySettings: ({ afterSignIn }: { afterSignIn?: React.ReactNode }) => (
    <>
      <div id="organization-sign-in" />
      {afterSignIn}
    </>
  ),
}));

vi.mock("../AuthenticationSection.js", () => ({
  DomainSettingsSection: () => <div id="email-domain" />,
  A2ASecretSection: () => <div id="cross-app-authentication" />,
}));

vi.mock("../OrgGeneralSection.js", () => ({
  OrgIconControl: () => <span data-testid="org-icon" />,
  WorkspaceUrlSettingsSection: () => <div id="workspace-url" />,
}));

vi.mock("../GroupsSection.js", () => ({
  GroupsSection: () => <div data-testid="groups" />,
}));

vi.mock("../TeamOnboardingCards.js", () => ({
  PendingInvitationsCard: () => null,
  JoinByDomainCard: () => null,
  NoOrgCard: () => <div data-testid="no-org" />,
}));

import {
  OrgAuthenticationPage,
  describeSignInMethods,
} from "./OrgAuthenticationPage.js";
import { OrgGeneralPage } from "./OrgGeneralPage.js";
import { OrgMembersPage } from "./OrgMembersPage.js";

function orgInfo(overrides: Partial<OrgInfo> = {}): OrgInfo {
  return {
    email: "owner@example.test",
    orgId: "org_1",
    orgName: "Example",
    role: "owner",
    icon: null,
    iconRevision: 0,
    emailConfigured: true,
    orgs: [],
    pendingInvitations: [],
    domainMatches: [],
    allowedDomain: "example.test",
    workspaceUrl: null,
    requiredAuthProvider: null,
    signInMethods: { emailPassword: true, google: true, github: false },
    a2aSecretSet: true,
    ...overrides,
  };
}

describe("Organization settings pages", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.members = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function render(node: React.ReactNode) {
    act(() => root.render(node));
  }

  describe("describeSignInMethods", () => {
    const t = (key: string, options?: Record<string, unknown>) =>
      (ENGLISH[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(options?.[name] ?? ""),
      );

    it("names only the methods the deployment has", () => {
      expect(
        describeSignInMethods(
          { emailPassword: true, google: false, github: false },
          t as never,
        ),
      ).toBe("Email and password.");
      expect(
        describeSignInMethods(
          { emailPassword: true, google: true, github: false },
          t as never,
        ),
      ).toBe("Email and password, and Google.");
      expect(
        describeSignInMethods(
          { emailPassword: true, google: true, github: true },
          t as never,
        ),
      ).toBe("Email and password, Google, and GitHub.");
    });
  });

  describe("Authentication", () => {
    it("shows an admin sign-in methods and domain auto-join, but not the shared secret", () => {
      mocks.org = orgInfo({ role: "admin", a2aSecretSet: undefined });
      render(<OrgAuthenticationPage />);

      const methods = container.querySelector("#sign-in-methods");
      expect(methods?.textContent).toContain("Email and password, and Google.");
      expect(container.querySelector("#email-domain")).not.toBeNull();
      expect(container.querySelector("#cross-app-authentication")).toBeNull();
    });

    it("shows the owner the shared secret", () => {
      mocks.org = orgInfo();
      render(<OrgAuthenticationPage />);

      expect(
        container.querySelector("#cross-app-authentication"),
      ).not.toBeNull();
    });

    it("lists each method and the variables that turn it on", () => {
      mocks.org = orgInfo({ role: "admin" });
      render(<OrgAuthenticationPage />);

      const view = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "View",
      );
      act(() => view!.click());

      const dialog = document.body.querySelector('[role="dialog"]');
      expect(dialog?.textContent).toContain("GOOGLE_CLIENT_ID");
      expect(dialog?.textContent).toContain("GITHUB_CLIENT_SECRET");
      expect(dialog?.textContent).toContain(
        "agentChat.settingsOrg.auth.methodConfigured",
      );
      expect(dialog?.textContent).toContain(
        "agentChat.settingsOrg.auth.methodNotConfigured",
      );
    });

    it("renders nothing for a member who reaches the page", () => {
      mocks.org = orgInfo({ role: "member", signInMethods: undefined });
      render(<OrgAuthenticationPage />);

      expect(container.querySelector("#sign-in-methods")).toBeNull();
      expect(container.querySelector("#email-domain")).toBeNull();
    });
  });

  describe("General", () => {
    it("lets an admin rename the organization but not delete it", () => {
      mocks.org = orgInfo({ role: "admin" });
      render(<OrgGeneralPage />);

      expect(
        container.querySelector(
          '#organization-name input[aria-label="agentChat.settingsOrg.general.name"]',
        ),
      ).not.toBeNull();
      expect(container.querySelector("#delete-organization")).toBeNull();
    });

    it("shows a member the name read-only", () => {
      mocks.org = orgInfo({ role: "member" });
      render(<OrgGeneralPage />);

      expect(container.querySelector("#organization-name input")).toBeNull();
      expect(
        container.querySelector("#organization-name")?.textContent,
      ).toContain("Example");
      expect(container.querySelector("#workspace-url")).toBeNull();
    });

    it("gives the owner the danger zone", () => {
      mocks.org = orgInfo();
      render(<OrgGeneralPage />);

      expect(container.querySelector("#delete-organization")).not.toBeNull();
    });

    it("offers a way into an organization when there is none", () => {
      mocks.org = orgInfo({ orgId: null, role: null });
      render(<OrgGeneralPage />);

      expect(container.querySelector('[data-testid="no-org"]')).not.toBeNull();
    });
  });

  describe("Members", () => {
    beforeEach(() => {
      mocks.members = [
        { email: "owner@example.test", role: "owner", name: "Olive Owner" },
        { email: "admin@example.test", role: "admin", name: "Ada Admin" },
        { email: "member@example.test", role: "member", name: "Mo Member" },
      ];
    });

    it("gives the owner a role select for everyone else", () => {
      mocks.org = orgInfo();
      render(<OrgMembersPage />);

      expect(
        container.querySelector('[aria-label="Role for Ada Admin"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[aria-label="Role for Mo Member"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[aria-label="Role for Olive Owner"]'),
      ).toBeNull();
      expect(mocks.header).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: expect.anything() }),
      );
    });

    it("gives an admin a remove menu for members only, and no role select", () => {
      mocks.org = orgInfo({ role: "admin", email: "admin@example.test" });
      render(<OrgMembersPage />);

      expect(container.querySelector('[aria-label^="Role for"]')).toBeNull();
      expect(
        container.querySelector('[aria-label="More actions for Mo Member"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[aria-label="More actions for Olive Owner"]'),
      ).toBeNull();
    });

    it("gives a member no controls and no invite action", () => {
      mocks.org = orgInfo({ role: "member", email: "member@example.test" });
      render(<OrgMembersPage />);

      expect(container.querySelector('[aria-label^="Role for"]')).toBeNull();
      expect(
        container.querySelector('[aria-label^="More actions"]'),
      ).toBeNull();
      expect(mocks.header).toHaveBeenLastCalledWith(null);
    });
  });
});
