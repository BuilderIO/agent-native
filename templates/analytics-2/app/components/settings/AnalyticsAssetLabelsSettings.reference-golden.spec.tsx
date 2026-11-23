// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeMarkup } from "@/skins/reference/testing/markup";
import {
  buttonByText,
  click,
  mount,
  settle,
  type,
  type Mounted,
} from "@/skins/reference/testing/mount";

import {
  CATEGORIES,
  STATUSES,
  assetLabels,
  labelRoute,
} from "./AnalyticsAssetLabelsSettings.fixtures";

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  ...(await import("./AnalyticsAssetLabelsSettings.fixtures"))
    .assetLabelHooksMock,
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  ...(await import("@/skins/reference/testing/i18n")).i18nMock,
}));

const { AnalyticsAssetLabelsSettings } =
  await import("./AnalyticsAssetLabelsSettings");

function withQueries(ui: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
  );
}

describe("asset labels, reference markup", () => {
  let mounted: Mounted | undefined;

  beforeEach(() => assetLabels.reset());
  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
  });

  const show = (view: "asset-statuses" | "asset-categories") => {
    mounted = mount(
      withQueries(<AnalyticsAssetLabelsSettings route={labelRoute(view)} />),
    );
    return mounted;
  };
  const golden = (state: string) =>
    expect(normalizeMarkup(mounted!.container.innerHTML)).toMatchFileSnapshot(
      `./__goldens__/AnalyticsAssetLabelsSettings.${state}.html`,
    );

  it("statuses: an admin with no status yet", async () => {
    show("asset-statuses");
    await golden("statuses.empty");
  });

  it("statuses: an admin with statuses", async () => {
    assetLabels.statuses = STATUSES;
    show("asset-statuses");
    await golden("statuses.admin");
  });

  it("statuses: a member reads the list only", async () => {
    assetLabels.isAdmin = false;
    assetLabels.statuses = STATUSES;
    show("asset-statuses");
    await golden("statuses.member");
  });

  it("statuses: a name typed and another color picked", async () => {
    assetLabels.statuses = STATUSES;
    const { container } = show("asset-statuses");
    type(container.querySelector("input")!, "In review");
    click(container.querySelector('[aria-label="Use #3f6fb5"]')!);
    await golden("statuses.form-filled");
  });

  it("statuses: after a status is added the name clears and the color stays", async () => {
    assetLabels.statuses = STATUSES;
    const { container } = show("asset-statuses");
    type(container.querySelector("input")!, "  In review  ");
    click(container.querySelector('[aria-label="Use #3f6fb5"]')!);
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await settle();
    expect(assetLabels.callAction).toHaveBeenCalledWith("create-data-status", {
      name: "In review",
      color: "#3f6fb5",
    });
    await golden("statuses.added");
  });

  it("statuses: the status could not be created", async () => {
    assetLabels.statuses = STATUSES;
    assetLabels.callAction.mockRejectedValueOnce(
      new Error("A status with that name already exists."),
    );
    const { container } = show("asset-statuses");
    type(container.querySelector("input")!, "Draft");
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await settle();
    await golden("statuses.create-error");
  });

  it("statuses: remove asks the server for that status", async () => {
    assetLabels.statuses = STATUSES;
    const { container } = show("asset-statuses");
    click(container.querySelector('[aria-label="Remove Certified"]')!);
    await settle();
    expect(assetLabels.callAction).toHaveBeenCalledWith("delete-data-status", {
      id: "status-2",
    });
    await golden("statuses.removed");
  });

  it("categories: an admin with no category yet", async () => {
    show("asset-categories");
    await golden("categories.empty");
  });

  it("categories: an admin with categories", async () => {
    assetLabels.categories = CATEGORIES;
    show("asset-categories");
    await golden("categories.admin");
  });

  it("categories: a member reads the list only", async () => {
    assetLabels.isAdmin = false;
    assetLabels.categories = CATEGORIES;
    show("asset-categories");
    await golden("categories.member");
  });

  it("categories: the category could not be created", async () => {
    assetLabels.callAction.mockRejectedValueOnce("offline");
    const { container } = show("asset-categories");
    type(container.querySelector("input")!, "Finance");
    await act(async () => {
      buttonByText(container, "Add").click();
    });
    await settle();
    expect(assetLabels.callAction).toHaveBeenCalledWith(
      "create-data-category",
      { name: "Finance", color: "#d64545" },
    );
    await golden("categories.create-error");
  });
});
