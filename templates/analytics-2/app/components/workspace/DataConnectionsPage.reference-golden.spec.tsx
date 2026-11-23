// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dataConnections } from "@/components/data/WorkspaceDataConnections.fixtures";
import { i18nCatalog } from "@/i18n";
import { normalizeMarkup } from "@/skins/reference/testing/markup";
import {
  buttonByText,
  click,
  mount,
  settle,
  type Mounted,
} from "@/skins/reference/testing/mount";

vi.mock(
  "@/components/data/useDataConnectionActions",
  async () =>
    (await import("@/components/data/WorkspaceDataConnections.fixtures"))
      .dataConnectionActionsMock,
);
vi.mock("react-router", async (original) => ({
  ...(await original<typeof import("react-router")>()),
  useNavigate: () => dataConnections.navigate,
}));

const { DataConnectionsPage } = await import("./DataConnectionsPage");

function mountPage() {
  return mount(
    <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
      <DataConnectionsPage />
    </AgentNativeI18nProvider>,
  );
}

describe("data sources page, reference markup", () => {
  let mounted: Mounted | undefined;

  beforeEach(() => dataConnections.reset());
  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = "";
  });

  const golden = (state: string) =>
    expect(normalizeMarkup(mounted!.container.innerHTML)).toMatchFileSnapshot(
      `./__goldens__/DataConnectionsPage.${state}.html`,
    );
  /** A dialog renders outside the page, so these states are read from the document. */
  const goldenDocument = (state: string) =>
    expect(normalizeMarkup(document.body.innerHTML)).toMatchFileSnapshot(
      `./__goldens__/DataConnectionsPage.${state}.html`,
    );
  const options = (name: string) =>
    mounted!.container.querySelector(
      `[aria-label="${name} options"]`,
    ) as HTMLButtonElement;

  it("connections", async () => {
    mounted = mountPage();
    await golden("ready");
  });

  it("loading", async () => {
    dataConnections.isPending = true;
    mounted = mountPage();
    await golden("loading");
  });

  it("the list could not be loaded", async () => {
    dataConnections.isError = true;
    dataConnections.connections = [];
    mounted = mountPage();
    await golden("error");
  });

  it("no connection yet", async () => {
    dataConnections.connections = [];
    mounted = mountPage();
    await golden("empty");
  });

  it("the data browser button goes to the data browser", () => {
    mounted = mountPage();
    click(buttonByText(mounted.container, "Data browser"));
    expect(dataConnections.navigate).toHaveBeenCalledWith("/home/data");
  });

  it("the add dialog opens on the type picker and closes again", async () => {
    mounted = mountPage();
    click(buttonByText(mounted.container, "Connection"));
    await settle();
    await goldenDocument("add-dialog");
    click(document.querySelector('[aria-label="Close"]')!);
    await settle();
    await goldenDocument("add-dialog-closed");
  });

  it("the add dialog, with the one offered type chosen", async () => {
    mounted = mountPage();
    click(buttonByText(mounted.container, "Connection"));
    await settle();
    const card = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Google BigQuery"),
    );
    click(card!);
    await settle();
    await goldenDocument("add-dialog-form");
  });

  it("disables Connection when creation is revoked while an existing warehouse remains editable", async () => {
    dataConnections.canAddConnection = false;
    mounted = mountPage();
    const create = buttonByText(mounted.container, "Connection");
    expect(create.disabled).toBe(true);
    click(create);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    click(options("Sales warehouse"));
    click(buttonByText(document, "Edit"));
    await settle();
    expect(dataConnections.getForm).toHaveBeenCalledWith("connection-sales");
    expect(
      document.querySelector<HTMLInputElement>('[role="dialog"] input')?.value,
    ).toBe("Sales warehouse");
  });

  it("edit loads the connection's form and opens the dialog on it", async () => {
    mounted = mountPage();
    click(options("Sales warehouse"));
    click(buttonByText(mounted.container, "Edit"));
    await settle();
    expect(dataConnections.getForm).toHaveBeenCalledWith("connection-sales");
    await goldenDocument("edit-dialog");
  });

  it("the connection's form could not be loaded", async () => {
    dataConnections.getForm.mockRejectedValueOnce(
      new Error("The connection is locked."),
    );
    mounted = mountPage();
    click(options("Sales warehouse"));
    click(buttonByText(mounted.container, "Edit"));
    await settle();
    await golden("edit-error");
  });

  it("opening the add dialog and closing it clears the edit error", async () => {
    dataConnections.getForm.mockRejectedValueOnce("offline");
    mounted = mountPage();
    click(options("Sales warehouse"));
    click(buttonByText(mounted.container, "Edit"));
    await settle();
    await golden("edit-error-unknown");
    click(buttonByText(mounted.container, "Connection"));
    await settle();
    click(document.querySelector('[aria-label="Close"]')!);
    await settle();
    await golden("edit-error-cleared");
  });

  it("set as default and delete reach the page's actions", async () => {
    mounted = mountPage();
    click(options("Sales warehouse"));
    click(buttonByText(mounted.container, "Set as default"));
    await settle();
    expect(dataConnections.onSetDefault).toHaveBeenCalledWith(
      "connection-sales",
    );
    click(options("Sales warehouse"));
    click(buttonByText(mounted.container, "Delete"));
    click(buttonByText(mounted.container, "Confirm"));
    await settle();
    expect(dataConnections.onDelete).toHaveBeenCalledWith("connection-sales");
  });
});
