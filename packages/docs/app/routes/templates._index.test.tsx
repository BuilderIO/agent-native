// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useActionQuery = vi.hoisted(() => vi.fn());
const useLoaderData = vi.hoisted(() => vi.fn());
const loadCommunityAppCatalog = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({ useActionQuery }));
vi.mock("../../server/lib/community-apps.server", () => ({
  loadCommunityAppCatalog,
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

const seedApps = [
  { slug: "seed", name: "Seed app", description: "Built with the docs." },
];

describe("templates index", () => {
  beforeEach(() => {
    useLoaderData.mockReturnValue({ apps: seedApps });
    useActionQuery.mockReturnValue({ data: undefined });
    loadCommunityAppCatalog.mockReturnValue(new Promise(() => {}));
  });

  it("prerenders the seed catalog before refreshing it through the public action", async () => {
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
