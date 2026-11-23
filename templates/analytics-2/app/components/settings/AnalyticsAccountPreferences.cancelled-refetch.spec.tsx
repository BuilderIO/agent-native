// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { AnalyticsAccountPreferences } from "./AnalyticsAccountPreferences";

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: { email: "qa@example.test" } }),
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock(
  "@agent-native/toolkit/app/settings/account/PreferencesSettings",
  () => ({ PreferencesSettings: () => null }),
);
vi.mock("./useAnalyticsAccountPreferencesSections", () => ({
  useAnalyticsAccountPreferencesSections: () => [],
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

it("retains an acknowledged preference when its readback is cancelled", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const initial = { lineNumbers: false, fullWidthCells: false };
  let readValue = initial;
  let finishWrite: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("get-editor-preferences"))
      return Promise.resolve(Response.json(readValue));
    if (url.includes("set-editor-preferences"))
      return new Promise<Response>((resolve) => {
        finishWrite = resolve;
      });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const control = () =>
    container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="editorPreferences.lineNumbers"]',
    );
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AnalyticsAccountPreferences />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() =>
      expect(control()?.getAttribute("aria-checked")).toBe("false"),
    );
    await act(async () => {
      control()?.click();
    });
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf("function"));
    expect(control()?.getAttribute("aria-checked")).toBe("true");
    expect(
      client.getQueryData([
        "action",
        "get-editor-preferences",
        {},
        "qa@example.test",
      ]),
    ).toEqual(initial);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await act(async () => {
      finishWrite?.(Response.json({ ...initial, lineNumbers: true }));
    });
    await vi.waitFor(() => expect(control()?.disabled).toBe(false));
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("get-editor-preferences"),
      ),
    ).toHaveLength(1);
    expect(
      client.getQueryData([
        "action",
        "get-editor-preferences",
        {},
        "qa@example.test",
      ]),
    ).toEqual(initial);
    expect(control()?.getAttribute("aria-checked")).toBe("true");
    finishWrite = undefined;
    const width = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="editorPreferences.fullWidthCells"]',
    );
    await act(async () => {
      width?.click();
    });
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf("function"));
    await act(async () => {
      finishWrite?.(Response.json({ error: "offline" }, { status: 500 }));
    });
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull(),
    );
    expect(control()?.getAttribute("aria-checked")).toBe("true");
    expect(width?.getAttribute("aria-checked")).toBe("false");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    readValue = { ...initial, lineNumbers: false, fullWidthCells: true };
    await act(async () => {
      await client.refetchQueries({
        queryKey: ["action", "get-editor-preferences"],
      });
    });
    await vi.waitFor(() =>
      expect(control()?.getAttribute("aria-checked")).toBe("false"),
    );
    expect(
      container
        .querySelector(
          '[role="switch"][aria-label="editorPreferences.fullWidthCells"]',
        )
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  } finally {
    act(() => root.unmount());
    container.remove();
    client.clear();
    Reflect.deleteProperty(document, "visibilityState");
    vi.unstubAllGlobals();
  }
});

it("does not let a read begun before the write acknowledgment replace it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const initial = { lineNumbers: false, fullWidthCells: false };
  let reads = 0;
  let finishRead: ((response: Response) => void) | undefined;
  let finishWrite: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("get-editor-preferences")) {
        reads += 1;
        if (reads === 1) return Promise.resolve(Response.json(initial));
        return new Promise<Response>((resolve) => {
          finishRead = resolve;
        });
      }
      if (url.includes("set-editor-preferences"))
        return new Promise<Response>((resolve) => {
          finishWrite = resolve;
        });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const control = () =>
    container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="editorPreferences.lineNumbers"]',
    );
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AnalyticsAccountPreferences />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() =>
      expect(control()?.getAttribute("aria-checked")).toBe("false"),
    );
    let held: Promise<void> | undefined;
    await act(async () => {
      held = client.refetchQueries({
        queryKey: ["action", "get-editor-preferences"],
      });
    });
    await vi.waitFor(() => expect(finishRead).toBeTypeOf("function"));
    await act(async () => {
      control()?.click();
    });
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf("function"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await act(async () => {
      finishWrite?.(Response.json({ ...initial, lineNumbers: true }));
    });
    await vi.waitFor(() => expect(control()?.disabled).toBe(false));
    expect(control()?.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      finishRead?.(Response.json(initial));
      await held;
    });
    expect(control()?.getAttribute("aria-checked")).toBe("true");
  } finally {
    act(() => root.unmount());
    container.remove();
    client.clear();
    Reflect.deleteProperty(document, "visibilityState");
    vi.unstubAllGlobals();
  }
});
