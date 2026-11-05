// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  data: undefined as unknown,
  error: null as unknown,
  connected: [] as unknown[] | undefined,
  connectedError: null as unknown,
  mutate: vi.fn(),
  refetch: vi.fn(),
  options: {} as {
    onError?: (error: Error) => void;
    onSuccess?: () => void;
  },
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: (name: string) =>
    name === "get-hosted-apps-settings"
      ? {
          data: state.data,
          isError: state.error !== null,
          error: state.error,
          refetch: state.refetch,
        }
      : name === "list-connected-agents"
        ? {
            data: state.connectedError ? undefined : state.connected,
            isError: state.connectedError !== null,
            error: state.connectedError,
            refetch: state.refetch,
          }
        : { data: [], isError: false, error: null, refetch: state.refetch },
  useActionMutation: (_name: string, options: typeof state.options) => {
    state.options = options;
    return { mutate: state.mutate, isPending: false };
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { name?: string }) =>
    options?.name ? `${key}:${options.name}` : key,
}));

vi.mock("sonner", () => ({ toast: { error: state.toastError } }));

import { HostedAppsSettingsGroup } from "./hosted-apps-settings-group";

const hosted = (id: string, name: string, url: string, extra = {}) => ({
  id,
  name,
  description: "",
  url,
  source: "builtin",
  ...extra,
});

describe("HostedAppsSettingsGroup", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.data = { showHostedApps: true };
    state.error = null;
    state.connected = [
      hosted("mail", "Mail", "https://mail.agent-native.com/"),
    ];
    state.connectedError = null;
    state.mutate.mockReset();
    state.refetch.mockReset().mockResolvedValue(undefined);
    state.toastError.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const toggle = () =>
    container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  const mailRow = () => container.querySelector("#hosted-app-mail");
  const rowsState = () =>
    mailRow()?.closest("[data-state]")?.getAttribute("data-state");

  it("lists each hosted app with its host and an Open link", async () => {
    await act(async () => root.render(<HostedAppsSettingsGroup />));

    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(mailRow()?.textContent).toContain("Mail");
    expect(mailRow()?.textContent).toContain("mail.agent-native.com");
    const open = mailRow()?.querySelector("a");
    expect(open?.getAttribute("href")).toBe("https://mail.agent-native.com/");
    expect(open?.getAttribute("target")).toBe("_blank");
    expect(open?.getAttribute("aria-label")).toBe(
      "dispatch.pages.chatFirstOpenApp:Mail",
    );
    expect(rowsState()).toBe("shown");
  });

  it("lists the launchers' hosted apps A to Z, including ones the setting hides", async () => {
    state.data = { showHostedApps: false };
    state.connected = [
      hosted("slides", "Slides", "https://s/", { hiddenFromLaunchers: true }),
      hosted("chat", "Chat", "https://c/"),
      hosted("analytics", "Analytics", "https://a/"),
      { ...hosted("partner", "Partner", "https://p/"), source: "custom" },
    ];
    await act(async () => root.render(<HostedAppsSettingsGroup />));

    expect(
      [...container.querySelectorAll('[id^="hosted-app-"]')].map(
        (row) => row.id,
      ),
    ).toEqual(["hosted-app-analytics", "hosted-app-slides"]);
    expect(
      container
        .querySelector("#hosted-app-analytics")
        ?.closest("[data-state]")
        ?.getAttribute("data-state"),
    ).toBe("hidden");
  });

  it("keeps the switch when a refresh fails after a read", async () => {
    state.error = new Error("refresh failed");
    await act(async () => root.render(<HostedAppsSettingsGroup />));

    expect(toggle().getAttribute("aria-checked")).toBe("true");
  });

  it("shows a placeholder row, not an empty list, while hosted apps load", async () => {
    state.connected = undefined;
    await act(async () => root.render(<HostedAppsSettingsGroup />));

    expect(toggle()).not.toBeNull();
    expect(
      container.querySelector("[data-hosted-apps-loading]"),
    ).not.toBeNull();
    expect(container.querySelector('[id^="hosted-app-"]')).toBeNull();
  });

  it("reports a failed app list instead of showing no hosted apps", async () => {
    state.connectedError = new Error("discovery down");
    await act(async () => root.render(<HostedAppsSettingsGroup />));

    expect(toggle()).not.toBeNull();
    expect(container.textContent).toContain("list-connected-agents");
  });

  it("switches at once, dims the rows and rolls back when saving fails", async () => {
    await act(async () => root.render(<HostedAppsSettingsGroup />));

    await act(async () => toggle().click());
    expect(state.mutate).toHaveBeenCalledWith({ showHostedApps: false });
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(rowsState()).toBe("hidden");

    await act(async () => state.options.onError?.(new Error("Forbidden")));
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(rowsState()).toBe("shown");
    expect(state.toastError).toHaveBeenCalledWith(
      "dispatch.pages.hostedAppsSaveFailed",
      { description: "Forbidden" },
    );
  });

  it("keeps the switched value until the setting reads back, then follows reads", async () => {
    await act(async () => root.render(<HostedAppsSettingsGroup />));

    await act(async () => toggle().click());
    await act(async () => state.options.onSuccess?.());
    expect(state.refetch).not.toHaveBeenCalled();
    expect(toggle().getAttribute("aria-checked")).toBe("false");

    state.data = { ...(state.data as object), showHostedApps: false };
    await act(async () => root.render(<HostedAppsSettingsGroup />));
    expect(toggle().getAttribute("aria-checked")).toBe("false");

    state.data = { ...(state.data as object), showHostedApps: true };
    await act(async () => root.render(<HostedAppsSettingsGroup />));
    expect(toggle().getAttribute("aria-checked")).toBe("true");
  });

  it("offers the switch to repair an invalid stored value", async () => {
    state.data = undefined;
    state.error = Object.assign(new Error("Stored value is invalid"), {
      errorCode: "dispatch_hosted_apps_settings_invalid",
    });
    await act(async () => root.render(<HostedAppsSettingsGroup />));

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "dispatch.pages.hostedAppsSettingInvalid",
    );
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle().click());
    expect(state.mutate).toHaveBeenCalledWith({ showHostedApps: true });
    expect(toggle().getAttribute("aria-checked")).toBe("true");
  });

  it("shows any other read failure without a switch", async () => {
    state.data = undefined;
    state.error = Object.assign(new Error("db down"), {
      errorCode: "action_failed",
    });
    await act(async () => root.render(<HostedAppsSettingsGroup />));

    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.textContent).toContain("get-hosted-apps-settings");
  });
});
