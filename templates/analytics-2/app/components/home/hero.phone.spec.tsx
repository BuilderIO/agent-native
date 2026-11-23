// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";

import { HomePromptSection } from "./hero";

const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("@agent-native/toolkit/hooks", () => ({
  useIsMobile: () => viewport.mobile,
}));

function actionCount(mobile: boolean): number {
  viewport.mobile = mobile;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <HomePromptSection
          user={{ name: "QA Reviewer", email: "qa@workspace.test" } as never}
          title="Hello"
          agentComposer={<div />}
          contextProgress={null}
          contextProgressPending={false}
          callbacks={
            {
              canAnalyzeInNotebook: true,
              onSelectIntent: () => {},
            } as never
          }
        />
      </AgentNativeI18nProvider>,
    ),
  );
  const count = container.querySelectorAll(".ws-home-prompt-action").length;
  act(() => root.unmount());
  container.remove();
  return count;
}

it("drops the Ask / notebook intent toggle on phones only", () => {
  expect(actionCount(false)).toBe(2);
  expect(actionCount(true)).toBe(0);
});
