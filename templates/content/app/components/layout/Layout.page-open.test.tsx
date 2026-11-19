// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderUi } from "@/test-utils/render-ui";

// An in-app link to a page starts that page's reads while the route loads.
// A collection link can name the view the page opens on, and the open read
// has to ask for that view, or the table reads its rows again.

const reads = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/mcp-app-host", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/mcp-app-host")
  >()),
  useIsMcpAppWidgetEmbed: () => false,
}));
vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextComposerChip: () => null,
}));
vi.mock("@agent-native/toolkit/app/chat/AgentSidebar", () => ({
  AgentSidebar: ({ children }: { children: ReactNode }) => (
    <div data-testid="agent-sidebar">{children}</div>
  ),
  AgentToggleButton: () => <button type="button">toggle agent</button>,
}));
vi.mock("@agent-native/toolkit/app/org", () => ({
  InvitationBanner: () => <div data-testid="invitation-banner" />,
}));
vi.mock("@/components/sidebar/DocumentSidebar", () => ({
  DocumentSidebar: () => <aside data-testid="document-sidebar" />,
}));
vi.mock("@/components/editor/DocumentEditor", () => ({
  DocumentEditor: () => <div data-testid="document-editor" />,
}));
vi.mock("@/hooks/use-create-page", () => ({ useCreatePage: () => vi.fn() }));
vi.mock("@/hooks/use-creative-context-lab", () => ({
  useCreativeContextLab: () => false,
}));
vi.mock("@/hooks/use-documents", () => ({
  startPageOpenDocumentReads: reads.start,
}));
vi.mock("@/hooks/use-optimistic-document-title", () => ({
  useOptimisticDocumentTitle: () => null,
}));

import { Layout } from "./Layout";

afterEach(() => {
  reads.start.mockReset();
});

describe("an in-app link to a collection view", () => {
  it("starts the page's reads with the view the link names", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/page/:id",
          // The linked page's route is still loading.
          loader: ({ params }) =>
            params.id === "col-1" ? new Promise(() => {}) : null,
          element: (
            <Layout>
              <div data-testid="page" />
            </Layout>
          ),
        },
      ],
      { initialEntries: ["/page/doc-1"] },
    );
    renderUi(<RouterProvider router={router} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      void router.navigate("/page/col-1?databaseId=db-1&viewId=builder");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(reads.start).toHaveBeenCalledWith(
      expect.anything(),
      "col-1",
      { databaseId: "db-1", databaseDocumentId: null },
      { databaseViewId: "builder" },
    );
  });
});
