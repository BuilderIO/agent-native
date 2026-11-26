// @vitest-environment happy-dom

// The attach-only composer mode exists because the meeting-notes composer row
// carries a single paperclip control and no "+" menu. These cases pin the two
// things that make it that control rather than a menu trigger: the accessible
// name and the file input it opens. The default modes stay as they were.

import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import { PromptComposer, type PromptComposerProps } from "./PromptComposer.js";
import {
  ComposerRuntimeAdaptersProvider,
  type ComposerRuntimeAdapters,
} from "./runtime-adapters.js";
import type { TiptapComposerHandle } from "./TiptapComposer.js";

let root: Root;
let container: HTMLDivElement;
let adapters: ComposerRuntimeAdapters;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
  adapters = {
    resolvePath: (path) => `/test-app${path}`,
    resources: {
      useOrg: () => ({ data: { orgId: "test-org", role: "member" } }),
      useCreateMcpServer: () => ({ mutateAsync: vi.fn(async () => ({})) }),
      isMcpIntegrationAvailable: () => true,
      McpIntegrationDialog: () => null,
    },
    agentChat: {
      sendToAgentChat: vi.fn(),
      setContextItem: vi.fn(),
    },
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(props: Partial<PromptComposerProps> = {}) {
  const composerRef = React.createRef<TiptapComposerHandle>();
  await act(async () => {
    root.render(
      <ComposerRuntimeAdaptersProvider adapters={adapters}>
        <TooltipProvider>
          <PromptComposer
            composerRef={composerRef}
            onSubmit={vi.fn()}
            initialText="Draft "
            initialTextKey="attach-only"
            showModelSelector={false}
            modelStatusChecksEnabled={false}
            includeDefaultMentionSearch={false}
            includeDefaultSlashSkills={false}
            voiceEnabled={false}
            {...props}
          />
        </TooltipProvider>
      </ComposerRuntimeAdaptersProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return composerRef;
}

function attachButton() {
  return container.querySelector<HTMLButtonElement>(
    '[data-agent-composer-slot="attach-button"]',
  );
}

describe("composer attach-only mode", () => {
  it("renders one paperclip control instead of the context menu", async () => {
    await mount({ plusMenuMode: "attach-only", attachmentsEnabled: true });

    expect(
      container.querySelector('button[aria-label="Add context"]'),
    ).toBeNull();
    const button = attachButton();
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-label")).toBe("Attach files");
    expect(button!.querySelector("svg")).not.toBeNull();
  });

  it("keeps the hidden multiple-file input the control opens", async () => {
    await mount({ plusMenuMode: "attach-only", attachmentsEnabled: true });

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input!.multiple).toBe(true);
  });

  it("keeps both files selected together and removes each independently", async () => {
    await mount({ plusMenuMode: "attach-only", attachmentsEnabled: true });
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const files = [
      new File(["first draft"], "first.txt", { type: "text/plain" }),
      new File(["second draft"], "second.txt", { type: "text/plain" }),
    ];
    Object.defineProperty(input, "files", { configurable: true, value: files });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const strip = container.querySelector(".agent-composer-attachment-strip")!;
    expect(strip.textContent).toContain("first.txt");
    expect(strip.textContent).toContain("second.txt");
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Remove first.txt"]',
        )!
        .click();
    });
    expect(strip.textContent).not.toContain("first.txt");
    expect(strip.textContent).toContain("second.txt");
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Remove second.txt"]',
        )!
        .click();
    });
    expect(
      container.querySelector(".agent-composer-attachment-strip"),
    ).toBeNull();
  });

  it("still shows the context menu trigger in upload-only mode", async () => {
    await mount({ plusMenuMode: "upload-only", attachmentsEnabled: true });

    expect(attachButton()).toBeNull();
    expect(
      container.querySelector('button[aria-label="Add context"]'),
    ).not.toBeNull();
  });
});
