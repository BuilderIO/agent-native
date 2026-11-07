// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderUi } from "@/test-utils/render-ui";

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

vi.mock("@/hooks/use-document-properties", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-document-properties")>()),
  useDocumentProperties: () => mocks.query,
}));

vi.mock("./DocumentProperties", () => ({ DocumentProperties: () => null }));

import { DocumentInfoPanel } from "./DocumentInfoPanel";

function renderPanel() {
  renderUi(
    <DocumentInfoPanel
      document={
        {
          id: "row",
          description: "",
          databaseMembership: {
            databaseId: "database",
            databaseDocumentId: "database-page",
          },
        } as unknown as Document
      }
      documentContent=""
      canEdit
      onSaveDescription={async () => undefined}
    />,
  );
}

const placeholder = () =>
  document.querySelector('[aria-label="editor.properties.loadingContent"]');

describe("the Info panel's Content summary", () => {
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
    expect(document.querySelector("[data-document-info-content]")).toBeNull();
  });

  it("holds the place while a retry is running", () => {
    mocks.query.fetchStatus = "fetching";
    renderPanel();

    expect(placeholder()).not.toBeNull();
  });
});
