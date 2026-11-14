// @vitest-environment happy-dom

import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderUi } from "@/test-utils/render-ui";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import type { DocumentPagePanelTab } from "./document-page-panel-state";
import { DocumentPagePanel } from "./DocumentPagePanel";

function renderPanel(tab: DocumentPagePanelTab, withAgentHead = true) {
  const agentHeadSlotRef = createRef<HTMLDivElement>();
  renderUi(
    <DocumentPagePanel
      open
      tab={tab}
      layout={{ mode: "dock", width: 380 }}
      pageEditorOwner="page"
      panelRef={createRef()}
      spacerRef={createRef()}
      headingRef={createRef()}
      agentSlotRef={createRef()}
      agentHeadSlotRef={withAgentHead ? agentHeadSlotRef : undefined}
      onClose={() => {}}
    >
      <div />
    </DocumentPagePanel>,
  );
  const heading = document.querySelector("h2");
  if (!heading) throw new Error("No panel heading");
  return { heading, agentHead: agentHeadSlotRef.current };
}

describe("DocumentPagePanel's head", () => {
  it("gives the agent's tools the title's place, and keeps the title for screen readers", () => {
    const { heading, agentHead } = renderPanel("agent");
    expect(heading.textContent).toBe("navigation.agent");
    expect(heading.classList.contains("sr-only")).toBe(true);
    expect(agentHead?.classList.contains("flex")).toBe(true);
    expect(agentHead?.nextElementSibling?.getAttribute("aria-label")).toBe(
      "editor.toolbar.closeUtilityPanel",
    );
  });

  it("shows the title on other tabs, and keeps the agent's tools in place but hidden", () => {
    const { heading, agentHead } = renderPanel("info");
    expect(heading.classList.contains("sr-only")).toBe(false);
    expect(agentHead?.isConnected).toBe(true);
    expect(agentHead?.classList.contains("hidden")).toBe(true);
  });

  it("shows the title over an agent that brings no tools of its own", () => {
    const { heading } = renderPanel("agent", false);
    expect(heading.classList.contains("sr-only")).toBe(false);
    expect(document.querySelector("[data-document-panel-agent-head]")).toBe(
      null,
    );
  });
});
