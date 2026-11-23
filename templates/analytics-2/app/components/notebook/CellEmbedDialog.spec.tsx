// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { CellEmbedDialog } from "./CellEmbedDialog";

it("shows an iframe for the latest published app's cell, copies it, and says it shares nothing by itself", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const written: string[] = [];
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: {
      writeText: async (text: string) => {
        written.push(text);
      },
    },
  });
  window.history.replaceState(null, "", "/analytics-2/project/p1/latest/logic");
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  const onClose = vi.fn();
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <CellEmbedDialog projectId="p1" cellId="c 1" onClose={onClose} />
        </AgentNativeI18nProvider>,
      ),
    );
    const code = document.querySelector<HTMLTextAreaElement>(".nb-embed-code");
    expect(code?.value).toContain(
      `src="${window.location.origin}/analytics-2/app/p1/latest?embed=c%201"`,
    );
    expect(code?.value.startsWith("<iframe")).toBe(true);
    expect(document.body.textContent).toContain("needs access to this app");
    const copy = [...document.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Copy embed code",
    );
    await act(async () => copy?.click());
    expect(written).toEqual([code?.value]);
    expect(document.body.textContent).toContain("Embed code copied");
  } finally {
    window.history.replaceState(null, "", "/");
    await act(async () => root.unmount());
    mount.remove();
  }
});
