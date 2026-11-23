// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";

import { OrganizationSourceDefaultControl } from "./OrganizationSourceDefaultControl";
const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  refetch: vi.fn(),
  options: undefined as unknown,
  queryOptions: undefined as
    | { onServerResult?: (view: unknown, metadata: unknown) => void }
    | undefined,
  deliverServer: true,
  view: {
    revision: 4,
    editOrgId: "org-test",
    dbtEnabled: true,
    tokenConfigured: true,
    config: {
      hasDbtMetadata: true,
      dbtVersion: "current",
      dbtCloudHostname: "cloud.getdbt.com",
      dbtEnvironmentId: "42",
    },
  },
  queryError: false,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key.split(".").reduce((value: any, part) => value?.[part], messages) ?? key,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (
    _name: string,
    _args: unknown,
    options: typeof mocks.queryOptions,
  ) => {
    mocks.queryOptions = options;
    useEffect(() => {
      if (!mocks.queryError && mocks.deliverServer)
        options?.onServerResult?.(mocks.view, {});
    }, [mocks.queryError, mocks.view]);
    return {
      data: mocks.view,
      isLoading: false,
      isFetching: false,
      isError: mocks.queryError,
      error: mocks.queryError ? new Error("Read failed") : null,
      refetch: mocks.refetch,
    };
  },
  useActionMutation: (_name: string, options: unknown) => {
    mocks.options = options;
    return { mutateAsync: mocks.mutate, isPending: false };
  },
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryError = false;
  mocks.deliverServer = true;
  mocks.view.revision = 4;
  mocks.mutate.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue({
    data: { ...mocks.view, revision: 5 },
    isError: false,
    error: null,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});
async function openMenu(canManage = true) {
  await act(async () =>
    root.render(
      <OrganizationSourceDefaultControl
        canManage={canManage}
        isDefault={false}
        name="Fixture warehouse"
        onSelect={() => undefined}
        pending={false}
      />,
    ),
  );
  const trigger = host.querySelector("button");
  if (trigger)
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
async function edit() {
  await openMenu();
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((el) => el.textContent?.trim() === "Edit");
  expect(item).toBeDefined();
  await act(async () => item?.click());
}
it("offers Edit on the configured organization connection and saves dbt without a key", async () => {
  await edit();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector("textarea")).toBeNull();
  expect(
    document.querySelector<HTMLInputElement>("#bigquery-dbt-token")?.value,
  ).toBe("");
  const update = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((el) => el.textContent?.trim() === "Update connection");
  expect(update).toBeDefined();
  await act(async () => {
    update?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(mocks.options).toMatchObject({
    privateInputs: true,
    uiOnly: true,
    retry: false,
    retryUiCapability: false,
  });
  expect(mocks.mutate).toHaveBeenCalledWith({
    dbt: mocks.view.config,
    expectedRevision: 4,
    expectedOrgId: "org-test",
  });
  expect(mocks.refetch).toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("does not expose editing to a member without management access", async () => {
  await openMenu(false);
  expect(host.querySelector("button")).toBeNull();
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("keeps an unconfirmed save open when readback returns cached data with an error", async () => {
  mocks.refetch.mockResolvedValue({
    data: { ...mocks.view, revision: 5 },
    isError: true,
    error: new Error("Read failed"),
  });
  await edit();
  const update = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((el) => el.textContent?.trim() === "Update connection");
  await act(async () => {
    update?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "could not be confirmed",
  );
});

it("does not initialize editing from query-cache data before a canonical server result", async () => {
  mocks.deliverServer = false;
  await edit();
  expect(
    [...document.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === "Update connection",
    ),
  ).toBeUndefined();
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it("shows a resolved load error and recovers through Retry", async () => {
  mocks.queryError = true;
  await edit();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "The saved dbt settings could not be loaded",
  );
  expect(document.body.textContent).not.toContain("sources.");
  mocks.refetch.mockImplementation(async () => {
    mocks.queryError = false;
    mocks.queryOptions?.onServerResult?.(mocks.view, {});
    return { data: mocks.view, isError: false, error: null };
  });
  const retry = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((el) => el.textContent?.trim() === "Retry");
  expect(retry).toBeDefined();
  await act(async () => {
    retry?.click();
  });
  expect(document.querySelector("#bigquery-dbt-token")).not.toBeNull();
});

it("keeps a save unconfirmed when its readback belongs to another workspace", async () => {
  mocks.refetch.mockResolvedValue({
    data: { ...mocks.view, revision: 5, editOrgId: "another-org" },
    isError: false,
    error: null,
  });
  await edit();
  const update = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((el) => el.textContent?.trim() === "Update connection");
  await act(async () => {
    update?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "could not be confirmed",
  );
});
it("recovers an unconfirmed write by cancelling and reopening at the fresh revision", async () => {
  mocks.mutate.mockRejectedValueOnce(new Error("Response unavailable"));
  await edit();
  const button = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (el) => el.textContent?.trim() === text,
    );
  await act(async () => {
    button("Update connection")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "could not be confirmed",
  );
  await act(async () => {
    button("Cancel")?.click();
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  mocks.view = { ...mocks.view, revision: 5 };
  mocks.refetch.mockResolvedValue({
    data: { ...mocks.view, revision: 6 },
    isError: false,
    error: null,
  });
  await edit();
  await act(async () => {
    button("Update connection")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(mocks.mutate).toHaveBeenLastCalledWith({
    dbt: mocks.view.config,
    expectedRevision: 5,
    expectedOrgId: "org-test",
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
