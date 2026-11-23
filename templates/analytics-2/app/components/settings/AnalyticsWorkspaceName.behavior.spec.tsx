// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import messages from "../../i18n/en-US";
import { AnalyticsPreferencesPage } from "./AnalyticsPreferencesPage";
const m = vi.hoisted(() => ({
  options: { keywordCase: "upper", newlineBeforeClauses: true },
  mutateAsync: vi.fn(async (_v: unknown) => ({})),
}));
vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  actionErrorMessage: (error: Error) => error.message,
  useActionQuery: (name: string) => ({
    data:
      name === "get-workspace-name"
        ? { orgId: "workspace-a", name: "My workspace", canEdit: true }
        : { options: m.options },
    refetch: vi.fn(),
    isLoading: false,
  }),
  useActionMutation: () => ({ mutateAsync: m.mutateAsync, isPending: false }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => {
    let value: unknown = messages;
    for (const part of key.split("."))
      value =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined;
    return typeof value === "string" ? value : key;
  },
}));
it("reaches workspace rename from General, retains a failed draft, and closes after save", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  try {
    act(() => root.render(<AnalyticsPreferencesPage />));
    const edit = [...el.querySelectorAll("button")].find(
      (b) => b.textContent === "Edit workspace name",
    );
    expect(edit).toBeDefined();
    act(() => edit?.click());
    const input = document.querySelector<HTMLInputElement>(
      'input[name="workspaceName"]',
    );
    expect(input?.value).toBe("My workspace");
    if (!input) throw Error("Name field missing");
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "QA test workspace");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    m.mutateAsync.mockRejectedValueOnce(new Error("Try again"));
    const form = input.closest("form");
    await act(async () =>
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Try again",
    );
    expect(input.value).toBe("QA test workspace");
    await act(async () =>
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(m.mutateAsync).toHaveBeenLastCalledWith({
      name: "QA test workspace",
      expectedOrgId: "workspace-a",
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    el.remove();
    vi.unstubAllGlobals();
  }
});
