// @vitest-environment happy-dom
import type { ContentDatabaseSource, Document } from "@shared/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { messagesByLocale } from "@/i18n-data";
import { renderUi } from "@/test-utils/render-ui";

const collection = vi.hoisted(() => ({
  read: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, values?: Record<string, unknown>) => {
    const text = key
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown>)[part],
        messagesByLocale["en-US"],
      ) as string;
    return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(values?.[name]),
    );
  },
}));
vi.mock("@/hooks/use-content-database", () => ({
  isContentDatabaseUnavailable: () => false,
  useContentDatabaseById: (databaseId: string | null) =>
    collection.read(databaseId),
}));

import { SyncedPageBanner } from "./SyncedPageBanner";

const membership = {
  databaseId: "database-1",
  databaseDocumentId: "collection-1",
  databaseTitle: "Blog",
  systemRole: null,
  position: 0,
  sourceId: "builder-1",
};

function rowPage(overrides: Partial<Document> = {}): Document {
  return {
    id: "page-1",
    title: "Launch post",
    databaseMembership: membership,
    ...overrides,
  } as unknown as Document;
}

function builderSource(
  metadata: Partial<ContentDatabaseSource["metadata"]> = {},
): ContentDatabaseSource {
  return {
    id: "builder-1",
    sourceType: "builder-cms",
    sourceName: "Blog articles",
    capabilities: { liveWritesEnabled: false },
    metadata: { primaryKey: "id", titleField: "title", ...metadata },
  } as unknown as ContentDatabaseSource;
}

const notionSource = {
  id: "notion-1",
  sourceType: "notion-database",
  sourceName: "Roadmap",
  capabilities: {},
  metadata: { federation: { role: "secondary" } },
} as unknown as ContentDatabaseSource;

function banner() {
  return document.querySelector<HTMLElement>("[data-synced-page-banner]");
}

describe("Synced page banner", () => {
  beforeEach(() => {
    collection.read.mockReset();
    collection.read.mockReturnValue({ data: undefined });
  });

  it("says a GitHub page is view only, with Open in GitHub, without reading its collection", () => {
    renderUi(
      <SyncedPageBanner
        document={rowPage({
          source: {
            mode: "github",
            url: "https://github.com/acme/handbook/blob/main/docs/a.md",
          },
        })}
      />,
    );
    expect(banner()?.dataset.syncedPageBanner).toBe("github");
    expect(banner()?.textContent).toContain(
      "View only. This page follows a file in GitHub",
    );
    expect(banner()?.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/acme/handbook/blob/main/docs/a.md",
    );
    expect(collection.read).toHaveBeenCalledWith(null);
  });

  it.each([
    ["read_only", "Edits here aren’t sent to Builder."],
    [
      "stage_only",
      "Edits here can be saved to Builder after review, never published.",
    ],
    ["publish_updates", "Edits here can be published to Builder after review."],
  ] as const)(
    "says a Builder page's model and what editing does in %s",
    (writeMode, said) => {
      collection.read.mockReturnValue({
        data: { sources: [builderSource({ writeMode })] },
      });
      renderUi(<SyncedPageBanner document={rowPage()} />);
      expect(banner()?.dataset.syncedPageBanner).toBe("builder");
      expect(banner()?.textContent).toBe(
        `This page comes from the Blog articles model in Builder. ${said}`,
      );
    },
  );

  it("says which Notion database adds details", () => {
    collection.read.mockReturnValue({ data: { sources: [notionSource] } });
    renderUi(
      <SyncedPageBanner
        document={rowPage({
          databaseMembership: { ...membership, sourceId: null },
        })}
      />,
    );
    expect(banner()?.dataset.syncedPageBanner).toBe("notion");
    expect(banner()?.textContent).toContain(
      "Some details on this page come from the Roadmap database in Notion",
    );
  });

  it("shows nothing on a page no source fills", () => {
    collection.read.mockReturnValue({ data: { sources: [] } });
    renderUi(<SyncedPageBanner document={rowPage()} />);
    expect(banner()).toBe(null);
  });
});
