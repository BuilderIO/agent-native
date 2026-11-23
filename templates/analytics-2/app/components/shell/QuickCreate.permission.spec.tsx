import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";

import { QuickCreate } from "./QuickCreate";
import type { WorkspaceShellFeatures } from "./types";

it("explains unavailable creation actions", () => {
  const features = {
    canCreateProject: false,
    canCreateThread: false,
  } as WorkspaceShellFeatures;
  const html = renderToStaticMarkup(
    <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
      <QuickCreate
        features={features}
        onCreateProject={vi.fn()}
        onCreateThread={vi.fn()}
      />
    </AgentNativeI18nProvider>,
  );
  expect(html).toContain("You do not have permission to create a project.");
  expect(html).toContain("You do not have permission to create a thread.");
});
