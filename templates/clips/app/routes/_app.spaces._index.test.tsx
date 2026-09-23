import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: { canManageOrg: false, role: "member" as string | null },
  organizations: { data: { currentId: "org-1" } },
  spaces: { data: { spaces: [] as unknown[] }, isLoading: false },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => {
    const messages: Record<string, string> = {
      "navigation.spaces": "Spaces",
      "navigation.noSpaces": "No spaces yet",
      "navigation.noSpacesAdminCta":
        "Ask an organization admin to create the first space.",
      "createSpaceDialog.description":
        "Organize recordings by project or team so everyone can find the work that matters.",
      "createSpaceDialog.newSpace": "Create space",
    };
    return messages[key] ?? key;
  },
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgRole: () => mocks.role,
}));

vi.mock("@/hooks/use-library", () => ({
  useOrganizations: () => mocks.organizations,
  useSpaces: () => mocks.spaces,
}));

vi.mock("@/components/library/create-space-dialog", () => ({
  CreateSpaceDialog: () => null,
}));

import SpacesIndexRoute from "./_app.spaces._index";

function renderSpaces() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SpacesIndexRoute />
    </MemoryRouter>,
  );
}

describe("SpacesIndexRoute empty state", () => {
  beforeEach(() => {
    mocks.role = { canManageOrg: false, role: "member" };
    mocks.organizations = { data: { currentId: "org-1" } };
    mocks.spaces = { data: { spaces: [] }, isLoading: false };
  });

  it("gives members a safe next step without offering space creation", () => {
    const markup = renderSpaces();

    expect(markup).toContain(
      "Organize recordings by project or team so everyone can find the work that matters. Ask an organization admin to create the first space.",
    );
    expect(markup).not.toContain("Create space");
  });

  it("keeps the create action for organization admins", () => {
    mocks.role = { canManageOrg: true, role: "admin" };

    const markup = renderSpaces();

    expect(markup).toContain("Create space");
    expect(markup).toContain(
      "Organize recordings by project or team so everyone can find the work that matters.",
    );
    expect(markup).not.toContain(
      "Ask an organization admin to create the first space.",
    );
  });
});
