// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

vi.mock("@agent-native/toolkit/app/shared", () => ({
  AgentNativeIcon: () => <span />,
}));

import { i18nCatalog } from "@/i18n";

import { ProjectHeader as View } from "./ProjectHeader";

function ProjectHeader(props: ComponentProps<typeof View>) {
  return (
    <MemoryRouter>
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <View {...props} />
      </AgentNativeI18nProvider>
    </MemoryRouter>
  );
}

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it("lists the failed cells when the error chip is hovered", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProjectHeader
          title="Revenue"
          canRename
          onRename={async () => {}}
          cellErrors={{ count: 2, labels: ["SQL 1", "Code 3"], jump: () => {} }}
        />,
      ),
    );
    const chip = container.querySelector<HTMLElement>(
      '[aria-label="2 errors"]',
    );
    if (chip == null) throw new Error("error chip is missing");
    expect(chip.textContent?.trim()).toBe("2");
    await act(async () => {
      chip.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      chip.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      chip.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      chip.focus();
    });
    await vi.waitFor(() =>
      expect(document.body.textContent ?? "").toContain("Cell errors"),
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Cell errors");
    expect(text).toContain("SQL 1");
    expect(text).toContain("Code 3");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
