// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildPromptComposerSubmission,
  PromptComposer,
  shouldGateComposerForMissingEngine,
  type PromptComposerFile,
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
  it("allows drafting and context selection before provider setup but preserves the draft when send is gated", async () => {
    const onSubmit = vi.fn();
    let state = "missing";
    const adapters = {
      models: {
        useAgentEngineConfigured: () => ({
          state,
          missing: state === "missing",
        }),
        fetchAgentEngineConfiguredState: vi.fn().mockResolvedValue("missing"),
        BuilderSetupCard: () => null,
      },
    };
    const render = async () =>
      act(async () => {
        root.render(
          React.createElement(ComposerRuntimeAdaptersProvider, {
            adapters,
            children: React.createElement(PromptComposer, {
              onSubmit,
              initialText: "Draft before connecting",
              initialTextKey: "provider-gate",
              showModelSelector: false,
              voiceEnabled: false,
              includeDefaultSlashSkills: false,
              contextMenuItems: [
                { id: "design", label: "Design", onSelect: vi.fn() },
              ],
            }),
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    await render();
    expect(container.querySelector('[contenteditable="true"]')).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Add context"]',
      )?.disabled,
    ).toBe(false);
    const send = async () =>
      act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Send message"]',
          )!
          .click();
      });
    await send();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      container.querySelector('[contenteditable="true"]')?.textContent,
    ).toContain("Draft before connecting");
    state = "unknown";
    await render();
    await send();
    expect(
      adapters.models.fetchAgentEngineConfiguredState,
    ).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    state = "configured";
    await render();
    await send();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

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

describe("shouldGateComposerForMissingEngine", () => {
  it("never disables the composer while the status check is unresolved", () => {
    for (const state of ["unknown", "unavailable"]) {
      expect(
        shouldGateComposerForMissingEngine({ state, hasSetupComponent: true }),
      ).toBe(false);
    }
  });

  it("gates only when a connect affordance can be rendered", () => {
    expect(
      shouldGateComposerForMissingEngine({
        state: "missing",
        hasSetupComponent: true,
      }),
    ).toBe(true);
    expect(
      shouldGateComposerForMissingEngine({
        state: "missing",
        hasSetupComponent: false,
      }),
    ).toBe(false);
  });

  it("leaves the composer usable once an engine is configured", () => {
    expect(
      shouldGateComposerForMissingEngine({
        state: "configured",
        hasSetupComponent: true,
      }),
    ).toBe(false);
  });
});

describe("buildPromptComposerSubmission", () => {
  it("passes images through files only — never inlines base64 into prompt text", async () => {
    // Images are passed to `files` for the host to process through the
    // attachment pipeline. They must NOT be inlined as base64 in `text`
    // (≈700K tokens per MB of image data).
    const file = new File(["fake image"], "sketch.png", {
      type: "image/png",
    });

    const result = await buildPromptComposerSubmission({
      text: "",
      attachments: [
        {
          id: "sketch.png",
          name: "sketch.png",
          type: "image",
          file,
        },
      ],
    });

    expect(result.files).toEqual([file]);
    // text must not contain any base64 data or uploaded-image markup
    expect(result.text).not.toContain("data:image");
    expect(result.text).not.toContain("<uploaded-image");
  });

  it("escapes inline attachment metadata in standalone submissions", async () => {
    const file = new File(["hello"], 'bad"name&.md', {
      type: "text/markdown",
    });

    const result = await buildPromptComposerSubmission({
      text: "Review this",
      attachments: [
        {
          id: "bad",
          name: file.name,
          type: "document",
          file,
        },
      ],
    });

    expect(result.text).toContain('name="bad&quot;name&amp;.md"');
    expect(result.text).not.toContain('name="bad"name&.md"');
  });

  it("does not include image data in prompt text regardless of file size", async () => {
    // Both small and large images stay in `files` only.
    const smallFile = new File(["small image"], "small.png", {
      type: "image/png",
    });
    const largeFile = new File([new Uint8Array(3 * 1024 * 1024)], "large.png", {
      type: "image/png",
    });

    for (const file of [smallFile, largeFile]) {
      const result = await buildPromptComposerSubmission({
        text: "",
        attachments: [{ id: file.name, name: file.name, type: "image", file }],
      });
      expect(result.files).toEqual([file]);
      expect(result.text).not.toContain("data:image");
    }
  });
});

describe("PromptComposer scoped runtime", () => {
  it("does not loop when the selection observer updates state with an inline callback", async () => {
    let calls = 0;
    function ObserverHarness() {
      const [, setSelection] = React.useState<unknown>();
      return React.createElement(PromptComposer, {
        includeDefaultSlashSkills: false,
        onModelSelectionChange: (selection) => {
          calls += 1;
          setSelection(selection);
        },
        onSubmit: () => {},
        showModelSelector: false,
        voiceEnabled: false,
      });
    }

    await act(async () => {
      root.render(React.createElement(ObserverHarness));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(calls).toBe(1);
  });

  it("does not carry attachments across draft scopes", async () => {
    let attachedFiles: PromptComposerFile[] = [];
    const renderComposer = (draftScope: string) =>
      root.render(
        React.createElement(PromptComposer, {
          attachmentsEnabled: true,
          draftScope,
          includeDefaultSlashSkills: false,
          onAttachmentsChange: (files) => {
            attachedFiles = files;
          },
          onSubmit: () => {},
          plusMenuMode: "upload-only",
          showModelSelector: false,
          voiceEnabled: false,
        }),
      );

    await act(async () => {
      renderComposer("prompt-scope-a");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["pending"], "pending.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(attachedFiles).toHaveLength(1);

    await act(async () => {
      renderComposer("prompt-scope-b");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(attachedFiles).toHaveLength(0);
  });
});
