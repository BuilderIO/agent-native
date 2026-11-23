// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";

import messages from "@/i18n/en-US";

import { ProjectNotFound } from "./ProjectNotFound";

it("names a missing notebook project as a project, not a published app", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <MemoryRouter>
            <ProjectNotFound projectId="prj_missing" />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      ),
    );
    expect(container.querySelector("strong")?.textContent).toBe(
      "Project not found",
    );
    expect(container.textContent).toContain(
      "This link points at a project that is not in this workspace.",
    );
    expect(container.textContent).not.toContain("App unavailable");
    expect(container.textContent).not.toContain(
      "You don’t have access to this page.",
    );
    expect(container.querySelector('a[href="/home/all"]')?.textContent).toBe(
      "Back to Projects",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
