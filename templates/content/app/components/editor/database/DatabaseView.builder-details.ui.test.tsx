// @vitest-environment happy-dom
import type { ContentDatabaseSource } from "@shared/api";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { click, renderUi } from "@/test-utils/render-ui";

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("@agent-native/toolkit/app/settings", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/toolkit/app/settings")
  >()),
  useBuilderStatus: () => ({ status: { configured: false }, refetch: vi.fn() }),
  useBuilderConnectFlow: () => ({}),
}));

import { DatabaseSettingsSourcePanel } from "./DatabaseView";

const items = {
  id: "source-items",
  databaseId: "database-1",
  sourceType: "builder-cms",
  sourceName: "Blog articles",
  sourceTable: "blog-article",
  syncState: "linked",
  lastRefreshedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  lastError: null,
  bodyHydration: null,
  capabilities: { liveWritesEnabled: true },
  fields: [],
  changeSets: [],
  metadata: {
    primaryKey: "id",
    titleField: "title",
    federation: { role: "primary" },
  },
} as unknown as ContentDatabaseSource;

const authors = {
  ...items,
  id: "source-authors",
  sourceName: "Authors",
  sourceTable: "author",
  metadata: {
    primaryKey: "id",
    titleField: "name",
    federation: { role: "secondary" },
  },
} as unknown as ContentDatabaseSource;

const idle = {
  attach: false,
  changeRole: false,
  refresh: false,
  hydration: false,
  disconnect: false,
  review: false,
  execute: false,
  writeMode: false,
  changeRoleSourceId: null,
  refreshSourceId: null,
  hydrationSourceId: null,
  disconnectSourceId: null,
  reviewSourceId: null,
  executeSourceId: null,
  writeModeSourceId: null,
};

function renderModelStep(
  nav: ComponentProps<typeof DatabaseSettingsSourcePanel>["nav"],
) {
  const onNavPush = vi.fn();
  renderUi(
    <DatabaseSettingsSourcePanel
      source={items}
      sources={[items, authors]}
      databaseId="database-1"
      documentId="doc-1"
      isFilesDatabase={false}
      githubPlace={{
        databaseId: "database-1",
        documentId: "doc-1",
        spaceId: "space-1",
        parentId: null,
        systemRole: null,
        pageCount: 3,
        canEdit: true,
      }}
      itemCount={3}
      canEdit
      canManage
      nav={nav}
      onNavPush={onNavPush}
      onNavReplace={vi.fn()}
      onAttachBuilderSource={vi.fn()}
      onFederateSource={vi.fn()}
      onChangeSourceRole={vi.fn()}
      onDisconnectSecondary={vi.fn()}
      onRefreshSource={vi.fn()}
      onHydrateBuilderBodies={vi.fn()}
      onSourceUnlinked={vi.fn()}
      onReviewBuilderUpdate={vi.fn()}
      onSetBuilderLiveWrites={vi.fn()}
      sourceActionPending={false}
      builderAttachPreviewPending={false}
      sourcePendingOperations={idle}
    />,
  );
  return { onNavPush };
}

function queryButton(name: string) {
  return (
    Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent.trim() === name,
    ) ?? null
  );
}

describe("An attached Builder model in Sources", () => {
  it("offers Choose details for a model that adds details, and opens the picker", async () => {
    const { onNavPush } = renderModelStep([
      { kind: "model", sourceId: "source-authors", sourceName: "Authors" },
    ]);
    const choose = queryButton("Choose details");
    if (!choose) throw new Error('No "Choose details" button');
    await click(choose);
    expect(onNavPush).toHaveBeenCalledWith({
      kind: "fieldPicker",
      sourceId: "source-authors",
      sourceName: "Authors",
    });
  });

  it("keeps the items model's own panel, which has no details to choose", () => {
    renderModelStep([
      { kind: "model", sourceId: "source-items", sourceName: "Blog articles" },
    ]);
    expect(document.querySelector('[data-source-panel="builder"]')).not.toBe(
      null,
    );
    expect(queryButton("Choose details")).toBe(null);
  });
});
