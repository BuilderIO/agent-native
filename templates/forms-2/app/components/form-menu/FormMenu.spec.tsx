// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => {
    const catalog: Record<string, string> = {
      "forms.common.moreActions": "More actions",
      "forms.common.rename": "Rename",
      "forms.common.move": "Move",
      "forms.common.delete": "Delete",
      "forms.menu.copyLink": "Copy link to share",
      "forms.routes.edit": "Edit",
    };
    return (key: string) => catalog[key] ?? key;
  },
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: { workspaces: [] } }),
  useActionMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}));
vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/components/ui/sonner", () => ({
  sonnerToast: { success: vi.fn(), error: vi.fn() },
}));

import { FormMenu } from "./FormMenu";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const form = {
  id: "form-1",
  name: "QA form",
  workspaceId: "ws-1",
  folderId: null,
};

beforeEach(() => {
  mocks.navigate.mockClear();
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("FormMenu", () => {
  it("offers Edit for an existing form and opens the editor", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    act(() =>
      createRoot(host).render(
        <FormMenu form={form} label="Actions for QA form" />,
      ),
    );
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for QA form"]',
    );
    expect(trigger).not.toBeNull();
    act(() => {
      trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      trigger?.click();
    });
    const items = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ].map((e) => (e.textContent || "").trim());
    expect(items).toContain("Edit");
    const edit = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ].find((e) => (e.textContent || "").trim() === "Edit");
    act(() => {
      edit?.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button: 0 }),
      );
      edit?.click();
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/forms/form-1/edit");
  });
});
