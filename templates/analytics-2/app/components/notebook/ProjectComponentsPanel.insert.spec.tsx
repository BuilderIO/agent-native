// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { ProjectComponentsPanel } from "./ProjectComponentsPanel";

it("report QA-1795079397 a listed component can be placed in the notebook, not only read as a label", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  const onInsert = vi.fn();
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <ProjectComponentsPanel
            components={[
              {
                id: "c1",
                name: "Revenue blocks",
                sourceProjectId: "p1",
                cellCount: 3,
                updatedAt: "2026-11-12T00:00:00Z",
              },
            ]}
            onClose={() => {}}
            onInsert={onInsert}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const button = mount.querySelector<HTMLButtonElement>(
      'button[aria-label="Insert Revenue blocks"]',
    );
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    expect(onInsert).toHaveBeenCalledWith("c1", "Revenue blocks");
  } finally {
    await act(async () => root.unmount());
    mount.remove();
  }
});
