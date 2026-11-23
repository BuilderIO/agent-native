// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { AnalyticsAccountPreferences } from "./AnalyticsAccountPreferences";

const state = vi.hoisted(() => ({
  email: "one@example.test",
  values: { lineNumbers: false, fullWidthCells: false },
  isError: false,
  isFetchedAfterMount: true,
  mutate: vi.fn(),
  refetch: vi.fn(async () => ({ isError: false })),
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: { email: state.email } }),
}));
vi.mock(
  "@agent-native/toolkit/app/settings/account/PreferencesSettings",
  () => ({ PreferencesSettings: () => <p>toolkit-preferences</p> }),
);
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "editorPreferences.behavior": "Behavior",
      "editorPreferences.lineNumbers": "Line numbers",
      "editorPreferences.fullWidthCells": "Full width Notebook cells",
      "editorPreferences.vimKeyBindings": "Vim key bindings",
      "editorPreferences.saveFailed": "Save failed",
      "editorPreferences.retry": "Retry",
    })[key] ?? key,
}));
vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: (
    name: string,
    _params: unknown,
    options?: {
      onRequestStart?: () => unknown;
      onServerResult?: (
        value: unknown,
        metadata: { requestContext: unknown; persistAllowed: boolean },
      ) => void;
    },
  ) => ({
    data:
      name === "get-editor-preferences"
        ? state.values
        : { owner: state.email, content: "", revision: null },
    isLoading: false,
    isFetchedAfterMount: state.isFetchedAfterMount,
    isError: name === "get-editor-preferences" && state.isError,
    refetch: async () => {
      const requestContext = options?.onRequestStart?.();
      const result = await state.refetch();
      if (!result.isError)
        options?.onServerResult?.(state.values, {
          requestContext,
          persistAllowed: false,
        });
      return result;
    },
  }),
  useActionMutation: () => ({ mutateAsync: state.mutate, isPending: false }),
}));
it("report 455/456: controls save choices, roll back failures and switch account", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const toggle = (label: string) => {
    const control =
      container.querySelector<HTMLButtonElement>(
        `[role="switch"][aria-label="${label}"]`,
      ) ??
      [
        ...container.querySelectorAll<HTMLButtonElement>('[role="switch"]'),
      ].find((el) =>
        el.closest("[data-settings-row]")?.textContent?.includes(label),
      );
    if (!control) throw Error(`Missing ${label} switch`);
    return control;
  };
  try {
    act(() => root.render(<AnalyticsAccountPreferences />));
    expect(container.textContent).toContain("Line numbers");
    expect(container.textContent).not.toContain("toolkit-preferences");
    expect(container.textContent).not.toContain("Manage your user preferences");
    expect(container.textContent).toContain("Full width Notebook cells");
    state.mutate.mockRejectedValueOnce(new Error("offline"));
    await act(async () => toggle("Line numbers").click());
    expect(state.mutate).toHaveBeenCalledWith({ lineNumbers: true });
    expect(toggle("Line numbers").getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).toContain("Save failed");
    state.mutate.mockImplementationOnce(async (patch) => {
      state.values = { ...state.values, ...patch };
      return state.values;
    });
    let finishReadback: (result: { isError: boolean }) => void = () => {};
    state.refetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReadback = resolve;
        }),
    );
    await act(async () => {
      toggle("Full width Notebook cells").click();
      await Promise.resolve();
    });
    expect(toggle("Line numbers").disabled).toBe(true);
    act(() => toggle("Line numbers").click());
    expect(state.mutate).toHaveBeenCalledTimes(2);
    await act(async () => {
      finishReadback({ isError: false });
      await Promise.resolve();
    });
    expect(state.mutate).toHaveBeenLastCalledWith({ fullWidthCells: true });
    expect(
      toggle("Full width Notebook cells").getAttribute("aria-checked"),
    ).toBe("true");
    let rejectSave: (reason: Error) => void = () => {};
    state.mutate.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    );
    await act(async () => {
      toggle("Line numbers").click();
      await Promise.resolve();
    });
    state.email = "two@example.test";
    state.values = { lineNumbers: true, fullWidthCells: false };
    act(() => root.render(<AnalyticsAccountPreferences />));
    state.email = "one@example.test";
    state.values = { lineNumbers: false, fullWidthCells: true };
    act(() => root.render(<AnalyticsAccountPreferences />));
    expect(toggle("Line numbers").disabled).toBe(false);
    expect(toggle("Line numbers").getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      rejectSave(new Error("offline"));
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("Save failed");
    expect(toggle("Line numbers").disabled).toBe(false);
    expect(toggle("Line numbers").getAttribute("aria-checked")).toBe("false");
    expect(
      toggle("Full width Notebook cells").getAttribute("aria-checked"),
    ).toBe("true");
    state.mutate.mockResolvedValueOnce({
      lineNumbers: true,
      fullWidthCells: true,
    });
    state.refetch.mockImplementationOnce(async () => {
      state.isError = true;
      return { isError: true };
    });
    await act(async () => toggle("Line numbers").click());
    act(() => root.render(<AnalyticsAccountPreferences />));
    state.refetch.mockImplementationOnce(async () => {
      state.isError = false;
      state.values = { lineNumbers: false, fullWidthCells: false };
      return { isError: false };
    });
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Retry")
        ?.click(),
    );
    act(() => root.render(<AnalyticsAccountPreferences />));
    expect(toggle("Line numbers").getAttribute("aria-checked")).toBe("false");
    expect(
      toggle("Full width Notebook cells").getAttribute("aria-checked"),
    ).toBe("false");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("report A2-EDITOR-PREFERENCE-UI-READBACK: waits for the fresh read before allowing a stale cached setting to be changed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.email = "one@example.test";
  state.isError = false;
  state.values = { lineNumbers: false, fullWidthCells: false };
  state.isFetchedAfterMount = false;
  state.mutate.mockClear();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() => root.render(<AnalyticsAccountPreferences />));
    expect(
      container.querySelector('[role="switch"][aria-label="Line numbers"]'),
    ).toBeNull();
    state.values = { lineNumbers: true, fullWidthCells: false };
    state.isFetchedAfterMount = true;
    state.mutate.mockImplementationOnce(async (patch) => {
      state.values = { ...state.values, ...patch };
      return state.values;
    });
    act(() => root.render(<AnalyticsAccountPreferences />));
    const control = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Line numbers"]',
    );
    expect(control?.getAttribute("aria-checked")).toBe("true");
    await act(async () => control?.click());
    expect(state.mutate).toHaveBeenCalledWith({ lineNumbers: false });
  } finally {
    state.isFetchedAfterMount = true;
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps a newer acknowledged choice when an earlier account read finishes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.email = "one@example.test";
  state.values = { lineNumbers: false, fullWidthCells: false };
  state.isError = false;
  state.isFetchedAfterMount = true;
  state.mutate.mockReset();
  state.refetch.mockReset();
  let finishOld: (value: { isError: boolean }) => void = () => {};
  let finishNew: (value: { isError: boolean }) => void = () => {};
  state.mutate.mockResolvedValue({ lineNumbers: true, fullWidthCells: false });
  state.refetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  state.refetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishNew = resolve;
      }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () => root.render(<AnalyticsAccountPreferences />);
  const toggle = () =>
    container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Line numbers"]',
    );
  try {
    act(render);
    await act(async () => {
      toggle()?.click();
      await Promise.resolve();
    });
    expect(toggle()?.getAttribute("aria-checked")).toBe("true");
    state.email = "two@example.test";
    act(render);
    state.email = "one@example.test";
    act(render);
    await act(async () => {
      toggle()?.click();
      await Promise.resolve();
    });
    expect(toggle()?.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      finishOld({ isError: false });
      await Promise.resolve();
    });
    expect(toggle()?.getAttribute("aria-checked")).toBe("true");
    state.values = { lineNumbers: true, fullWidthCells: true };
    await act(async () => {
      finishNew({ isError: false });
      await Promise.resolve();
    });
    expect(toggle()?.getAttribute("aria-checked")).toBe("true");
    expect(
      container
        .querySelector(
          '[role="switch"][aria-label="Full width Notebook cells"]',
        )
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("report 454: Vim key bindings toggle saves the vim preference", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.email = "one@example.test";
  state.isError = false;
  state.isFetchedAfterMount = true;
  state.values = { lineNumbers: true, fullWidthCells: true };
  state.mutate.mockReset();
  state.mutate.mockImplementation(async (patch) => {
    state.values = { ...state.values, ...patch };
    return state.values;
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() => root.render(<AnalyticsAccountPreferences />));
    const vim = () =>
      container.querySelector<HTMLButtonElement>(
        '[role="switch"][aria-label="Vim key bindings"]',
      );
    expect(vim()?.getAttribute("aria-checked")).toBe("false");
    await act(async () => vim()?.click());
    expect(state.mutate).toHaveBeenCalledWith({ vim: true });
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
