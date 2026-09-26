// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PromptComposer,
  type PromptComposerFile,
  type PromptComposerProps,
} from "./PromptComposer.js";
import {
  ComposerRuntimeAdaptersProvider,
  type AgentChatContextItem,
} from "./runtime-adapters.js";
import type { TiptapComposerHandle } from "./TiptapComposer.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("controlled composer context", () => {
  it("uses the shared upload menu without host entries and retains the explicit hidden mode", async () => {
    await mount();
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add context"]',
    )!;
    expect(trigger).not.toBeNull();
    await act(async () =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu.querySelector('[role="searchbox"]')).not.toBeNull();
    expect(menu.textContent).toBe("Upload File");
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await mount({ plusMenuMode: "hidden" });
    expect(
      container.querySelector('button[aria-label="Add context"]'),
    ).toBeNull();
  });
  async function mount(props: Partial<PromptComposerProps> = {}) {
    const composerRef = React.createRef<TiptapComposerHandle>();
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(
        <PromptComposer
          composerRef={composerRef}
          onSubmit={onSubmit}
          initialText="Keep the editable draft"
          initialTextKey="quick-start"
          showModelSelector={false}
          modelStatusChecksEnabled={false}
          includeDefaultSlashSkills={false}
          voiceEnabled={false}
          {...props}
        />,
      );
    });
    return { composerRef, onSubmit };
  }

  async function attachFile() {
    const file = new File(["example"], "reference.pdf", {
      type: "application/pdf",
    });
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    return file;
  }

  it("bounds the attachment strip and keeps overflow scrollable", async () => {
    await mount();
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: Array.from(
        { length: 10 },
        (_, index) => new File(["reference"], `reference-${index}.pdf`),
      ),
    });

    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );

    const strip = container.querySelector(".agent-composer-attachment-strip");
    expect(strip?.className).toContain("max-h-24");
    expect(strip?.className).toContain("overflow-y-auto");
  });

  it.each(["host", "provider"] as const)(
    "%s submission gating allows staging and blocks every send path until ready",
    async (gate) => {
      const composerRef = React.createRef<TiptapComposerHandle>();
      const onSubmit = vi.fn();
      const onSelect = vi.fn();
      const onRemove = vi.fn();
      const onRetry = vi.fn();
      const onDisabledClick = vi.fn();
      let blocked = true;
      let files: PromptComposerFile[] = [];
      const render = async () => {
        await act(async () => {
          root.render(
            <ComposerRuntimeAdaptersProvider
              adapters={{
                models: {
                  useAgentEngineConfigured: () => ({
                    state:
                      gate === "provider" && blocked ? "missing" : "configured",
                    missing: gate === "provider" && blocked,
                  }),
                  BuilderSetupCard: () => <div data-testid="provider-setup" />,
                },
              }}
            >
              <PromptComposer
                composerRef={composerRef}
                onSubmit={onSubmit}
                submissionDisabled={gate === "host" && blocked}
                onDisabledClick={onDisabledClick}
                placeholder="Prepare your prompt"
                showModelSelector={false}
                modelStatusChecksEnabled={gate === "provider"}
                includeDefaultSlashSkills={false}
                voiceEnabled={false}
                onAttachmentsChange={(next) => {
                  files = next;
                }}
                contextMenuItems={[
                  { id: "brief", label: "Choose brief", onSelect },
                ]}
                contextItems={[
                  {
                    key: "brief",
                    title: "Brief",
                    context: "Snapshot",
                    status: "error",
                    blocksSubmission: false,
                  },
                ]}
                onRemoveContextItem={onRemove}
                onRetryContextItem={onRetry}
              />
            </ComposerRuntimeAdaptersProvider>,
          );
        });
      };
      await render();
      const editor = container.querySelector<HTMLElement>(
        '[contenteditable="true"]',
      )!;
      expect(editor).not.toBeNull();
      await act(async () => composerRef.current!.setText("Staged draft"));
      const file = await attachFile();
      expect(files).toEqual([file]);
      const contextButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Add context"]',
      )!;
      expect(contextButton.disabled).toBe(false);
      await act(async () =>
        contextButton.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        ),
      );
      const contextGroup = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((element) => element.textContent === "Add context")!;
      await act(async () => contextGroup.click());
      const option = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((element) => element.textContent?.includes("Choose brief"))!;
      expect(option).toBeDefined();
      await act(async () => option.click());
      expect(onSelect).toHaveBeenCalledOnce();
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Retry Brief context"]',
          )!
          .click();
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Remove Brief context"]',
          )!
          .click();
      });
      expect(onRetry).toHaveBeenCalledWith("brief");
      expect(onRemove).toHaveBeenCalledWith("brief");
      expect(onDisabledClick).not.toHaveBeenCalled();
      const send = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Send message"]',
      )!;
      expect(send.disabled).toBe(true);
      await act(async () => {
        send.click();
        editor.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
        editor.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            metaKey: true,
            bubbles: true,
          }),
        );
        editor.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            ctrlKey: true,
            bubbles: true,
          }),
        );
        expect(await composerRef.current!.submitWithText("Quick start")).toBe(
          false,
        );
      });
      expect(onSubmit).not.toHaveBeenCalled();
      expect(editor.textContent).toBe("Staged draft");
      expect(files).toEqual([file]);
      blocked = false;
      await render();
      await act(async () => {
        expect(await composerRef.current!.submitWithText("Ready now")).toBe(
          true,
        );
      });
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit.mock.calls[0][0]).toBe("Ready now");
      expect(onSubmit.mock.calls[0][1]).toEqual([file]);
    },
  );

  it("preserves full-surface disabled semantics independently of the submit-only gate", async () => {
    const { composerRef, onSubmit } = await mount({
      disabled: true,
      contextMenuItems: [
        { id: "brief", label: "Choose brief", onSelect: vi.fn() },
      ],
    });
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Add context"]',
      )!.disabled,
    ).toBe(true);
    await act(async () =>
      expect(await composerRef.current!.submitWithText("Quick start")).toBe(
        false,
      ),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("quick starts use the current files, model and immutable context without replacing the draft first", async () => {
    const contextItems = [
      { key: "brief", title: "Brief", context: "Snapshot" },
    ];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onSubmit = vi.fn().mockReturnValue(gate);
    const { composerRef } = await mount({
      contextItems,
      onSubmit,
      showModelSelector: true,
      availableModels: [
        {
          engine: "example",
          label: "Example",
          models: ["example-model"],
          configured: true,
        },
      ],
      selectedModel: "example-model",
      selectedEngine: "example",
      selectedEffort: "high",
      onModelChange: vi.fn(),
    });
    const file = await attachFile();
    let submission!: Promise<boolean>;
    await act(async () => {
      submission = composerRef.current!.submitWithText(
        "Create from the reference",
      );
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]).toMatchObject([
      "Create from the reference",
      [file],
      [],
      {
        model: "example-model",
        engine: "example",
        effort: "high",
        contextItems,
      },
    ]);
    expect(
      container.querySelector('[contenteditable="true"]')?.textContent,
    ).toBe("Keep the editable draft");
    contextItems[0].context = "Later change";
    expect(onSubmit.mock.calls[0][3].contextItems[0].context).toBe("Snapshot");
    await act(async () => {
      release();
      expect(await submission).toBe(true);
    });
    expect(
      container.querySelector('[contenteditable="true"]')?.textContent,
    ).toBe("");
  });

  it("returns false and retains the typed draft and files after a rejected quick start", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Submit unavailable"));
    let files: PromptComposerFile[] = [];
    const { composerRef } = await mount({
      onSubmit,
      onAttachmentsChange: (next) => {
        files = next;
      },
    });
    const file = await attachFile();
    await act(async () =>
      expect(await composerRef.current!.submitWithText("Quick start")).toBe(
        false,
      ),
    );
    expect(
      container.querySelector('[contenteditable="true"]')?.textContent,
    ).toBe("Keep the editable draft");
    expect(files).toEqual([file]);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Submit unavailable",
    );
  });

  it.each(["pending", "error"] as const)(
    "quick starts cannot bypass %s context",
    async (status) => {
      const { composerRef, onSubmit } = await mount({
        contextItems: [{ key: "brief", title: "Brief", context: "", status }],
      });
      await act(async () =>
        expect(await composerRef.current!.submitWithText("Quick start")).toBe(
          false,
        ),
      );
      expect(onSubmit).not.toHaveBeenCalled();
      expect(
        container.querySelector('[contenteditable="true"]')?.textContent,
      ).toBe("Keep the editable draft");
    },
  );

  it("reports oversize context and keeps the draft instead of truncating or sending", async () => {
    const { composerRef, onSubmit } = await mount({
      contextItems: [
        { key: "brief", title: "Brief", context: "x".repeat(65536) },
      ],
    });
    await act(async () =>
      expect(await composerRef.current!.submitWithText("Quick start")).toBe(
        false,
      ),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Context is too large",
    );
    expect(
      container.querySelector('[contenteditable="true"]')?.textContent,
    ).toBe("Keep the editable draft");
  });

  it("a failed provider preflight leaves the draft untouched and returns false", async () => {
    const composerRef = React.createRef<TiptapComposerHandle>();
    const onSubmit = vi.fn();
    const preflight = vi.fn().mockResolvedValue("missing");
    await act(async () =>
      root.render(
        <ComposerRuntimeAdaptersProvider
          adapters={{
            models: {
              useAgentEngineConfigured: () => ({
                state: "unknown",
                missing: false,
              }),
              fetchAgentEngineConfiguredState: preflight,
            },
          }}
        >
          <PromptComposer
            composerRef={composerRef}
            onSubmit={onSubmit}
            initialText="Keep my draft"
            initialTextKey="gate"
            showModelSelector={false}
            includeDefaultSlashSkills={false}
          />
        </ComposerRuntimeAdaptersProvider>,
      ),
    );
    await act(async () =>
      expect(await composerRef.current!.submitWithText("Quick start")).toBe(
        false,
      ),
    );
    expect(preflight).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      container.querySelector('[contenteditable="true"]')?.textContent,
    ).toBe("Keep my draft");
  });

  it.each(["click", "enter"])(
    "allows %s steering past a nonremovable failed persisted source",
    async (method) => {
      const onSubmit = vi.fn();
      const remove = vi.fn();
      const source: AgentChatContextItem = {
        key: "system-source:qa",
        title: "QA reference",
        context: "systemId=qa; sourceId=qa",
        status: "error",
        statusMessage: "Source read failed",
        removable: false,
        blocksSubmission: false,
      };
      await act(async () => {
        root.render(
          React.createElement(PromptComposer, {
            onSubmit,
            contextItems: [source],
            onRemoveContextItem: remove,
            initialText: "Try a different direction",
            initialTextKey: "nonblocking-source",
            showModelSelector: false,
            modelStatusChecksEnabled: false,
            attachmentsEnabled: false,
            includeDefaultSlashSkills: false,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(
        container.querySelector(
          'button[aria-label="Remove QA reference context"]',
        ),
      ).toBeNull();
      expect(
        container
          .querySelector('[data-context-key="system-source:qa"]')
          ?.getAttribute("title"),
      ).toBe("Source read failed");
      await act(async () => {
        if (method === "click")
          container
            .querySelector<HTMLButtonElement>(
              'button[aria-label="Send message"]',
            )!
            .click();
        else
          container
            .querySelector('[contenteditable="true"]')!
            .dispatchEvent(
              new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
            );
      });
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit.mock.calls[0][3].contextItems).toEqual([source]);
      expect(remove).not.toHaveBeenCalled();
    },
  );
  it("renders context inside the frame, forwards inspection/retry/removal, and blocks click and keyboard submission until ready", async () => {
    const onSubmit = vi.fn();
    const onRemoveContextItem = vi.fn();
    const onInspectContextItem = vi.fn();
    const onRetryContextItem = vi.fn();
    const composerRef = React.createRef<TiptapComposerHandle>();
    const item: AgentChatContextItem = {
      key: "brief",
      title: "Brief",
      context: "Original context",
      status: "pending",
    };
    const render = async () => {
      await act(async () => {
        root.render(
          React.createElement(PromptComposer, {
            contextItems: [item],
            onRemoveContextItem,
            onInspectContextItem,
            onRetryContextItem,
            composerRef,
            onSubmit,
            initialText: "Review",
            initialTextKey: "context-test",
            showModelSelector: false,
            modelStatusChecksEnabled: false,
            attachmentsEnabled: false,
            includeDefaultSlashSkills: false,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    await render();
    expect(
      container
        .querySelector('[data-context-key="brief"]')
        ?.closest('[data-agent-composer-slot="root"]'),
    ).not.toBeNull();
    const clickSend = async () => {
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Send message"]',
          )!
          .click(),
      );
    };
    const pressEnter = async () => {
      await act(async () =>
        container
          .querySelector('[contenteditable="true"]')!
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          ),
      );
    };
    await clickSend();
    await pressEnter();
    expect(onSubmit).not.toHaveBeenCalled();
    item.status = "error";
    await render();
    await clickSend();
    await pressEnter();
    expect(onSubmit).not.toHaveBeenCalled();
    const contextRow = container.querySelector('[data-context-key="brief"]')!;
    await act(async () => {
      contextRow.querySelector<HTMLButtonElement>("button")!.click();
      contextRow
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Retry Brief context"]',
        )!
        .click();
      contextRow
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Remove Brief context"]',
        )!
        .click();
    });
    expect(onInspectContextItem).toHaveBeenCalledWith("brief");
    expect(onRetryContextItem).toHaveBeenCalledWith("brief");
    expect(onRemoveContextItem).toHaveBeenCalledWith("brief");
    expect(
      container.querySelector('[data-context-key="brief"]'),
    ).not.toBeNull();
    item.status = "ready";
    await render();
    await clickSend();
    expect(onSubmit).toHaveBeenCalledOnce();
    const [text, , references, options] = onSubmit.mock.calls[0];
    expect(text).toBe("Review");
    expect(references).toEqual([]);
    expect(options.contextItems).toEqual([item]);
    item.context = "Changed later";
    expect(options.contextItems[0].context).toBe("Original context");
    expect(Object.isFrozen(options.contextItems[0])).toBe(true);
  });
});
