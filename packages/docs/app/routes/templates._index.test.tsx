// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionQuery = vi.hoisted(() => vi.fn());
const useLoaderData = vi.hoisted(() => vi.fn());
const loadCommunityAppCatalog = vi.hoisted(() => vi.fn());
const seedApps = vi.hoisted(() => [
  { slug: "seed", name: "Seed app", description: "Built with the docs." },
]);
const communityAppsVisible = vi.hoisted(() => ({ value: false }));

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({ useActionQuery }));
vi.mock("../../server/lib/community-apps.server", () => ({
  loadCommunityAppCatalog,
}));
vi.mock("../components/community-apps", () => ({
  communityApps: seedApps,
  get SHOW_COMMUNITY_APPS() {
    return communityAppsVisible.value;
  },
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal()),
  useLocale: () => ({ locale: "en-US" }),
  useT: () => (key: string) => key,
}));
vi.mock("react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useLoaderData,
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock("../components/BuilderWaitlistPopover", () => ({
  BuildOnlinePopover: ({ trigger }: { trigger: React.ReactNode }) => trigger,
}));
vi.mock("../components/CommunityAppCard", () => ({
  CommunityAppCard: ({ app }: { app: { name: string } }) => (
    <output>{app.name}</output>
  ),
}));
vi.mock("../components/CommunityAppSubmissionDialog", () => ({
  CommunityAppSubmissionDialog: () => null,
}));
vi.mock("../components/TemplateCard", () => ({
  featuredTemplates: [],
  TemplateCard: () => null,
}));
vi.mock("../components/website-redesign/ds/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}));
vi.mock("../components/website-redesign/page-grid", () => ({
  GridInner: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PageSection: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import TemplatesPage, { loader } from "./templates._index";

describe("templates index", () => {
  beforeEach(() => {
    communityAppsVisible.value = false;
    useLoaderData.mockReturnValue({ apps: seedApps });
    useActionQuery.mockReturnValue({ data: undefined });
    loadCommunityAppCatalog.mockReturnValue(new Promise(() => {}));
  });

  it("hides the community catalog and disables its fetch", async () => {
    await expect(loader()).resolves.toEqual({ apps: expect.any(Array) });
    expect(loadCommunityAppCatalog).not.toHaveBeenCalled();

    render(<TemplatesPage />);
    expect(screen.queryByText("Seed app")).toBeNull();
    expect(screen.queryByText("templatesPage.communityTitle")).toBeNull();
    expect(
      screen.queryByText("templatesPage.communitySubmissionTitle"),
    ).toBeNull();
    expect(useActionQuery).toHaveBeenCalledWith(
      "list-community-apps",
      {},
      expect.objectContaining({ enabled: false }),
    );
  });

  it("renders and refreshes the community catalog when enabled", async () => {
    communityAppsVisible.value = true;
    await expect(loader()).resolves.toEqual({ apps: expect.any(Array) });
    expect(loadCommunityAppCatalog).not.toHaveBeenCalled();

    const view = render(<TemplatesPage />);
    expect(screen.getByText("Seed app")).toBeTruthy();
    expect(useActionQuery).toHaveBeenCalledWith(
      "list-community-apps",
      {},
      expect.objectContaining({ enabled: true }),
    );

    useActionQuery.mockReturnValue({
      data: {
        apps: [
          {
            slug: "published",
            name: "Published app",
            description: "Refreshed from the public catalog.",
          },
        ],
      },
    });
    view.rerender(<TemplatesPage />);

    expect(screen.getByText("Published app")).toBeTruthy();
    expect(screen.queryByText("Seed app")).toBeNull();
  });
});
