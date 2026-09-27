// @vitest-environment happy-dom

import type {
  ContentDatabaseSource,
  ContentDatabaseSourceFieldMapping,
} from "@shared/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  byLabel,
  click,
  nextFrame,
  press,
  queryByLabel,
  renderUi,
  typeInto,
} from "@/test-utils/render-ui";

const mutations = vi.hoisted(() => ({
  configure: {
    mutateAsync: vi.fn(async (_input: unknown): Promise<unknown> => ({})),
    isPending: false,
  },
  addSourceField: {
    mutateAsync: vi.fn(async (_input: unknown): Promise<unknown> => ({})),
    isPending: false,
  },
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key}(${Object.values(options).join(", ")})` : key,
}));

vi.mock("@/hooks/use-document-properties", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-document-properties")>()),
  useConfigureDocumentProperty: () => mutations.configure,
}));

vi.mock("@/hooks/use-content-database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-content-database")>()),
  useAddContentDatabaseSourceFieldProperty: () => mutations.addSourceField,
}));

import { AddProperty } from "./DocumentProperties";

const SEARCH = "editor.properties.searchPropertyTypes";
const addTypeLabel = (type: string) =>
  `editor.properties.addPropertyType(editor.propertyTypes.${type})`;

function sourceField(
  id: string,
  label: string,
): ContentDatabaseSourceFieldMapping {
  return {
    id,
    propertyId: null,
    propertyName: null,
    localFieldKey: id,
    sourceFieldKey: `data.${id}`,
    sourceFieldLabel: label,
    sourceFieldType: "text",
    mappingType: "property",
    writeOwner: "source",
    readOnly: false,
    provenance: "builder-cms",
    freshness: "fresh",
    lastSyncedAt: null,
  };
}

const articles = {
  id: "articles",
  sourceName: "Articles",
  metadata: { primaryKey: "id", titleField: "data.title" },
  fields: [sourceField("budget", "Budget")],
} as unknown as ContentDatabaseSource;

async function openPicker() {
  await click(byLabel("editor.properties.addProperty"));
  await nextFrame();
  return byLabel<HTMLInputElement>(SEARCH);
}

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mutations.configure.mutateAsync.mockReset();
  mutations.configure.mutateAsync.mockResolvedValue({});
  mutations.addSourceField.mutateAsync.mockReset();
  mutations.addSourceField.mutateAsync.mockResolvedValue({});
});

describe("Add Property picker", () => {
  it("focuses type search on open and adds the first match on Enter", async () => {
    renderUi(<AddProperty documentId="document" databaseId="database" />);

    const search = await openPicker();
    expect(document.activeElement).toBe(search);

    await typeInto(search, "numb");
    await press(search, "Enter");

    expect(mutations.configure.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutations.configure.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "document", type: "number" }),
    );
    expect(queryByLabel(SEARCH)).toBeNull();
  });

  it("stays open and marks the pending type busy while the property is added", async () => {
    const pending = deferred();
    mutations.configure.mutateAsync.mockReturnValue(pending.promise);
    renderUi(<AddProperty documentId="document" databaseId="database" />);
    await openPicker();

    await click(byLabel(addTypeLabel("text")));

    expect(byLabel(addTypeLabel("text")).getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(byLabel<HTMLButtonElement>(addTypeLabel("number")).disabled).toBe(
      true,
    );
    await press(byLabel(SEARCH), "Escape");
    expect(queryByLabel(SEARCH)).not.toBeNull();

    pending.resolve({});
    await nextFrame();
    expect(queryByLabel(SEARCH)).toBeNull();
  });

  it("shows the failure in the picker and re-enables it when adding fails", async () => {
    mutations.configure.mutateAsync.mockRejectedValue(
      new Error("Property limit reached"),
    );
    renderUi(<AddProperty documentId="document" databaseId="database" />);
    await openPicker();

    await click(byLabel(addTypeLabel("text")));

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "editor.properties.addPropertyFailed Property limit reached",
    );
    expect(queryByLabel(SEARCH)).not.toBeNull();
    expect(byLabel<HTMLButtonElement>(addTypeLabel("number")).disabled).toBe(
      false,
    );
  });

  it("adds a source field through the source-field mutation", async () => {
    renderUi(
      <AddProperty
        documentId="document"
        databaseId="database"
        sources={[articles]}
      />,
    );
    await openPicker();

    await click(byLabel("editor.properties.sourceField(Budget)"));

    expect(mutations.addSourceField.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutations.addSourceField.mutateAsync).toHaveBeenCalledWith({
      documentId: "document",
      sourceFieldId: "budget",
    });
    expect(mutations.configure.mutateAsync).not.toHaveBeenCalled();
    expect(queryByLabel(SEARCH)).toBeNull();
  });

  it("closes itself and hands off to the owning surface to connect a source", async () => {
    const onConnectSource = vi.fn();
    renderUi(
      <AddProperty
        documentId="document"
        databaseId="database"
        onConnectSource={onConnectSource}
      />,
    );
    await openPicker();

    const connect = [...document.querySelectorAll("button")].find(
      (button) =>
        button.textContent?.trim() === "editor.properties.connectASource",
    );
    if (!connect) throw new Error("No connect-a-source item");
    await click(connect);

    expect(onConnectSource).toHaveBeenCalledTimes(1);
    expect(queryByLabel(SEARCH)).toBeNull();
    expect(mutations.configure.mutateAsync).not.toHaveBeenCalled();
  });
});
