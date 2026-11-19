// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderUi } from "@/test-utils/render-ui";

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/hooks/use-document-properties", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-document-properties")>()),
  useDocumentProperties: () => mocks.query,
}));

vi.mock("./DocumentProperties", () => ({ DocumentProperties: () => null }));

import { DocumentInfoPanel } from "./DocumentInfoPanel";

const NOW = new Date("2026-11-10T15:00:00.000Z");

/** `undefined` clears a field the row Page has by default. */
function renderPanel(
  page: { [Key in keyof Document]?: Document[Key] | undefined } = {},
  documentContent = "",
) {
  renderUi(
    <DocumentInfoPanel
      document={
        {
          id: "row",
          description: "",
          createdAt: "2026-10-28T12:00:00.000Z",
          updatedAt: "2026-11-10T14:58:00.000Z",
          databaseMembership: {
            databaseId: "database",
            databaseDocumentId: "database-page",
          },
          ...page,
        } as unknown as Document
      }
      documentContent={documentContent}
      canEdit
      onSaveDescription={async () => undefined}
    />,
  );
}

const placeholder = () =>
  document.querySelector('[aria-label="editor.properties.loadingContent"]');
const details = () => document.querySelector("[data-document-page-details]");
const wordCounts = () =>
  document.querySelectorAll("[data-document-info-block-field]");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Info's Page details", () => {
  beforeEach(() => {
    mocks.query = {};
  });

  it("counts the Page's words and says when it was made and last edited", () => {
    renderPanel({ databaseMembership: undefined }, "One two three");

    expect(details()?.textContent).toContain("editor.properties.pageDetails");
    expect(wordCounts()).toHaveLength(1);
    expect(wordCounts()[0]?.textContent).toBe(
      'editor.properties.wordCount:{"count":3}',
    );
    expect(details()?.textContent).toContain("editor.properties.createdOn");
    expect(details()?.textContent).toContain(
      'editor.properties.editedAgo:{"time":"2 minutes ago"}',
    );
  });

  it("reads an edit under a minute old as just now", () => {
    renderPanel(
      { databaseMembership: undefined, updatedAt: "2026-11-10T14:59:30.000Z" },
      "",
    );
    expect(details()?.textContent).toContain("editor.properties.editedJustNow");
  });

  it("dates an edit over a week old", () => {
    renderPanel(
      { databaseMembership: undefined, updatedAt: "2026-10-30T12:00:00.000Z" },
      "",
    );
    expect(details()?.textContent).toContain("editor.properties.editedOn");
    expect(details()?.textContent).not.toContain("editor.properties.editedAgo");
  });

  it("leaves out a date it can't read", () => {
    renderPanel({ databaseMembership: undefined, createdAt: "not a date" }, "");
    expect(details()?.textContent).not.toContain("editor.properties.createdOn");
    expect(details()?.textContent).toContain("editor.properties.editedAgo");
  });
});

describe("Info's word counts after the Properties read", () => {
  beforeEach(() => {
    mocks.query = {
      data: undefined,
      dataUpdatedAt: 0,
      isError: true,
      isPlaceholderData: false,
      fetchStatus: "idle",
    };
  });

  it("stops holding a place for word counts once the read has failed", () => {
    renderPanel();

    expect(placeholder()).toBeNull();
    expect(wordCounts()).toHaveLength(0);
    // The dates still show.
    expect(details()?.textContent).toContain("editor.properties.createdOn");
  });

  it("doesn't count an early copy's words once the read has failed", () => {
    mocks.query.data = {
      documentId: "row",
      databaseId: "database",
      properties: [],
    };
    renderPanel();

    expect(wordCounts()).toHaveLength(0);
  });

  it("holds the place while a retry is running", () => {
    mocks.query.fetchStatus = "fetching";
    renderPanel();

    expect(placeholder()).not.toBeNull();
  });
});
