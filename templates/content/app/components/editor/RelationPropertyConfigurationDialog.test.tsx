// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messagesByLocale } from "../../i18n-data";

const configurationMutation = vi.hoisted(() => ({
  clearFailedRequest: vi.fn(),
  failedVariables: null,
  isPending: false,
  mutateAsync: vi.fn(async () => ({})),
  retryFailed: vi.fn(async () => ({})),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) => {
    const name = key.replace("relationships.", "") as keyof typeof copy;
    let value = String(copy[name] ?? key);
    for (const [placeholder, replacement] of Object.entries(options ?? {})) {
      value = value.split(`{{${placeholder}}}`).join(String(replacement));
    }
    return value;
  },
}));

vi.mock("@/hooks/use-content-database", () => ({
  useContentDatabases: () => ({
    data: {
      databases: [
        { databaseId: "campaigns", title: "Campaign Deliverables" },
        { databaseId: "people", title: "Marketing Team" },
      ],
    },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-content-relationships", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/use-content-relationships")
  >()),
  useConfigureContentRelationProperty: () => configurationMutation,
  useContentRelationshipTypes: () => ({
    data: { items: [] },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-relationship-app-state", () => ({
  useRelationshipAppState: vi.fn(),
}));

import { RelationPropertyConfigurationDialog } from "./RelationPropertyConfigurationDialog";

const copy = messagesByLocale["en-US"].relationships;

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("relation property configuration copy", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("keeps the shared bulk update status localized in Traditional Chinese", () => {
    expect(messagesByLocale["zh-TW"].relationships.bulkUpdated).toBe(
      "已更新 {{count}} 個關聯",
    );
  });

  it("uses the approved labels and collection terminology", () => {
    act(() => {
      root.render(
        <RelationPropertyConfigurationDialog
          open
          ownerDatabaseId="campaigns"
          onOpenChange={vi.fn()}
        />,
      );
    });

    expect(document.body.textContent).toContain("Column name");
    expect(document.body.textContent).toContain("Name shown on linked pages");
    expect(document.body.textContent).toContain(
      "If shown on linked pages, this relationship is called Deliverables.",
    );
    expect(document.body.textContent).toContain("Links per row");
    expect(document.body.textContent).toContain("Just one");
    expect(document.body.textContent).toContain("Multiple allowed");
    expect(document.body.textContent).toContain("Rows can also be left empty.");
    expect(document.body.textContent).toContain("Link to pages in");
    expect(
      document.body.querySelector<HTMLInputElement>("#relation-database-search")
        ?.placeholder,
    ).toBe("Search collections");
    expect(document.body.textContent).toContain(
      "Also add a column in the linked collection",
    );
  });

  it("keeps both collection names in context while filtering the picker", () => {
    act(() => {
      root.render(
        <RelationPropertyConfigurationDialog
          open
          ownerDatabaseId="campaigns"
          onOpenChange={vi.fn()}
        />,
      );
    });

    const target = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Marketing Team"),
    );
    act(() => target?.click());

    const search = document.body.querySelector<HTMLInputElement>(
      "#relation-database-search",
    );
    act(() => {
      if (search) setInputValue(search, "Marketing");
    });
    expect(document.body.textContent).toContain(
      "Each row in Campaign Deliverables can link to multiple pages in Marketing Team.",
    );
    expect(document.body.textContent).toContain(
      "Also add a column in Marketing Team",
    );

    const justOne = document.body.querySelector<HTMLInputElement>(
      'input[name="relation-cardinality"][value="one"]',
    );
    act(() => justOne?.click());
    expect(document.body.textContent).toContain(
      "Each row in Campaign Deliverables can link to just one page in Marketing Team.",
    );
  });
});
