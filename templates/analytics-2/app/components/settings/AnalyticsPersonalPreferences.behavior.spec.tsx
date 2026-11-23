// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import messages from "../../i18n/en-US";
import { AnalyticsAccountPreferences } from "./AnalyticsAccountPreferences";
const m = vi.hoisted(() => ({
  saved: {
    content: "Use concise answers.",
    owner: "owner@example.test",
    revision: { id: "personal-guidance", updatedAt: 12 },
  },
  mutateAsync: vi.fn(),
}));
vi.mock(
  "@agent-native/toolkit/app/settings/account/PreferencesSettings",
  () => ({ PreferencesSettings: () => <div>Existing account controls</div> }),
);
vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: () => ({ data: m.saved, refetch: vi.fn(), isLoading: false }),
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
it("edits personal instructions, keeps a failed draft and reads the saved content after remount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  let root = createRoot(container);
  const button = (text: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    );
  try {
    act(() => root.render(<AnalyticsAccountPreferences />));
    expect(button("Edit")).toBeDefined();
    act(() => button("Edit")?.click());
    const input = container.querySelector("textarea");
    if (!input) throw Error("Personal preferences editor missing");
    expect(input.value).toBe("Use concise answers.");
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(input, "QA test: prefer numbered steps.");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    m.mutateAsync.mockRejectedValueOnce({
      actionMessage: "Preferences changed. Reload before saving.",
    });
    await act(async () => button("Save")?.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Preferences changed",
    );
    expect(input.value).toBe("QA test: prefer numbered steps.");
    m.mutateAsync.mockImplementationOnce(async (args) => {
      m.saved = {
        ...m.saved,
        content: args.content,
        revision: { id: "personal-guidance", updatedAt: 13 },
      };
      return m.saved;
    });
    await act(async () => button("Save")?.click());
    expect(m.mutateAsync).toHaveBeenLastCalledWith({
      content: "QA test: prefer numbered steps.",
      expectedOwner: "owner@example.test",
      expectedRevision: { id: "personal-guidance", updatedAt: 12 },
    });
    expect(container.querySelector("textarea")).toBeNull();
    m.saved = {
      ...m.saved,
      content: "New instructions from another tab",
      revision: { id: "personal-guidance", updatedAt: 14 },
    };
    act(() => root.render(<AnalyticsAccountPreferences />));
    expect(container.textContent).toContain(
      "New instructions from another tab",
    );
    act(() => button("Edit")?.click());
    expect(container.querySelector("textarea")?.value).toBe(
      "New instructions from another tab",
    );
    m.saved = {
      ...m.saved,
      content: "Later background instructions",
      revision: { id: "personal-guidance", updatedAt: 15 },
    };
    act(() => root.render(<AnalyticsAccountPreferences />));
    expect(container.querySelector("textarea")?.value).toBe(
      "New instructions from another tab",
    );
    m.saved = {
      content: "Second account preferences",
      owner: "second@example.test",
      revision: { id: "second-guidance", updatedAt: 16 },
    };
    act(() => root.render(<AnalyticsAccountPreferences />));
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).not.toContain(
      "New instructions from another tab",
    );
    expect(container.textContent).toContain("Second account preferences");

    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<AnalyticsAccountPreferences />));
    expect(container.textContent).toContain("Second account preferences");
    expect(container.textContent).not.toContain("Existing account controls");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
