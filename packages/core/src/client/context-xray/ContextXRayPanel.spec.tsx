// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ContextManifest } from "../../shared/context-xray.js";
import { TooltipProvider } from "../components/ui/tooltip.js";
import { AgentNativeI18nProvider } from "../i18n.js";
import { ContextXRayPanel } from "./ContextXRayPanel.js";

const manifest: ContextManifest = {
  threadId: "thread-1",
  computedAt: 1,
  model: "gpt-5",
  totalTokens: 100,
  rawTokens: 100,
  reclaimedTokens: 0,
  tokenCountMethod: "exact",
  source: "structured",
  enforceable: true,
  segments: [],
  systemTokens: 100,
  conversationTokens: 0,
  systemSections: [
    {
      kind: "system",
      segmentId: "system-1",
      group: "System",
      label: "Framework instructions",
      provenance: "framework-core",
      governance: "required",
      tokenCount: 100,
      tokenMethod: "exact",
      contentHash: "hash",
      preview: "",
      timestamp: 1,
    },
  ],
};

describe("ContextXRayPanel localization", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("uses app overrides from the modern agentChat namespace", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={{
            sourceLocale: "en-US",
            messages: {
              agentChat: {
                contextXray: {
                  panelTitle: "Modern panel override",
                  systemOrdered: "Modern order override",
                  governance: { required: "Modern required override" },
                },
              },
            },
          }}
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <TooltipProvider>
            <ContextXRayPanel
              manifest={manifest}
              optimistic={new Map()}
              onPin={() => undefined}
              onEvict={() => undefined}
              onRestore={() => undefined}
            />
          </TooltipProvider>
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Modern panel override");
    expect(container.textContent).toContain("Modern order override");
    expect(container.textContent).toContain("Modern required override");
  });
});
