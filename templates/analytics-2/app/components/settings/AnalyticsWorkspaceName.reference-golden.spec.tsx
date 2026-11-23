// @vitest-environment happy-dom

import { act } from "react";
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

import { workspaceName } from "./AnalyticsWorkspaceName.fixtures";

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  ...(await import("./AnalyticsWorkspaceName.fixtures")).workspaceNameHooksMock,
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  ...(await import("@/skins/reference/testing/i18n")).i18nMock,
}));
vi.mock(
  "sonner",
  async () =>
    (await import("./AnalyticsWorkspaceName.fixtures")).workspaceNameToastMock,
);

const { AnalyticsWorkspaceName } = await import("./AnalyticsWorkspaceName");

describe("workspace name, reference markup", () => {
  let mounted: Mounted | undefined;

  beforeEach(() => workspaceName.reset());
  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = "";
  });

  const golden = (state: string) =>
    expect(normalizeMarkup(mounted!.container.innerHTML)).toMatchFileSnapshot(
      `./__goldens__/AnalyticsWorkspaceName.${state}.html`,
    );
  /** A dialog renders outside the panel, so these states are read from the document. */
  const goldenDocument = (state: string) =>
    expect(normalizeMarkup(document.body.innerHTML)).toMatchFileSnapshot(
      `./__goldens__/AnalyticsWorkspaceName.${state}.html`,
    );
  const submit = async () => {
    await act(async () => {
      document
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await settle();
  };

  it("an editor can open the dialog", async () => {
    mounted = mount(<AnalyticsWorkspaceName />);
    await golden("ready");
  });

  it("the general page names the control in full", async () => {
    mounted = mount(<AnalyticsWorkspaceName editLabel="Edit workspace name" />);
    await golden("ready-labelled");
  });

  it("someone who cannot edit", async () => {
    workspaceName.data = {
      orgId: "org-1",
      name: "Acme Analytics",
      canEdit: false,
    };
    mounted = mount(<AnalyticsWorkspaceName />);
    await golden("read-only");
  });

  it("loading", async () => {
    workspaceName.isLoading = true;
    mounted = mount(<AnalyticsWorkspaceName />);
    await golden("loading");
  });

  it("the name could not be loaded", async () => {
    workspaceName.isError = true;
    workspaceName.data = undefined;
    mounted = mount(<AnalyticsWorkspaceName />);
    await golden("load-error");
    click(buttonByText(mounted.container, "Retry"));
    expect(workspaceName.refetch).toHaveBeenCalledTimes(1);
  });

  it("the dialog, opened", async () => {
    mounted = mount(<AnalyticsWorkspaceName editLabel="Edit workspace name" />);
    click(buttonByText(mounted.container, "Edit workspace name"));
    await settle();
    expect(
      (document.querySelector("#analytics-workspace-name") as HTMLInputElement)
        .value,
    ).toBe("Acme Analytics");
    await goldenDocument("dialog");
  });

  it("the dialog with the name cleared", async () => {
    mounted = mount(<AnalyticsWorkspaceName />);
    click(buttonByText(mounted.container, "Edit"));
    await settle();
    type(
      document.querySelector("#analytics-workspace-name") as HTMLInputElement,
      "   ",
    );
    await goldenDocument("dialog-blank");
  });

  it("the name could not be saved", async () => {
    workspaceName.mutateAsync.mockRejectedValueOnce({
      actionMessage: "The workspace changed. Reload before saving.",
    });
    mounted = mount(<AnalyticsWorkspaceName />);
    click(buttonByText(mounted.container, "Edit"));
    await settle();
    type(
      document.querySelector("#analytics-workspace-name") as HTMLInputElement,
      "Acme Data",
    );
    await submit();
    await goldenDocument("dialog-save-error");
  });

  it("saved: the dialog closes and a toast says so", async () => {
    mounted = mount(<AnalyticsWorkspaceName />);
    click(buttonByText(mounted.container, "Edit"));
    await settle();
    type(
      document.querySelector("#analytics-workspace-name") as HTMLInputElement,
      "  Acme Data  ",
    );
    await submit();
    expect(workspaceName.mutateAsync).toHaveBeenCalledWith({
      name: "Acme Data",
      expectedOrgId: "org-1",
    });
    expect(workspaceName.refetch).toHaveBeenCalledTimes(1);
    expect(workspaceName.toastSuccess).toHaveBeenCalledWith(
      "Workspace name updated",
    );
    await settle();
    await goldenDocument("saved");
  });
});
