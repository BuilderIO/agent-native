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

function KeyedStaleIndexBoundary({
  resetKey,
  children,
}: {
  resetKey: string;
  children: React.ReactNode;
}) {
  return <React.Fragment key={resetKey}>{children}</React.Fragment>;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 200 })),
  );
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
  it("keeps the editor mounted while the host echoes each edit as initial text", async () => {
    const composerRef = React.createRef<TiptapComposerHandle>();
    const onSubmit = vi.fn();
    const EchoingPrompt = () => {
      const [text, setText] = React.useState("");
      return (
        <ComposerRuntimeAdaptersProvider
          adapters={{
            agentChat: {
              StaleIndexBoundary: KeyedStaleIndexBoundary,
            },
          }}
        >
          <PromptComposer
            composerRef={composerRef}
            onSubmit={onSubmit}
            initialText={text}
            initialTextKey="stable-while-typing"
            onTextChange={setText}
            showModelSelector={false}
            modelStatusChecksEnabled={false}
            includeDefaultSlashSkills={false}
            voiceEnabled={false}
          />
        </ComposerRuntimeAdaptersProvider>
      );
    };

    await act(async () => root.render(<EchoingPrompt />));
    const editor = container.querySelector<HTMLElement>(".ProseMirror")!;
    expect(editor).not.toBeNull();

    await act(async () => composerRef.current!.setText("typed at the end"));

    expect(container.querySelector(".ProseMirror")).toBe(editor);
    expect(editor.textContent).toBe("typed at the end");
  });

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
    expect(menu.textContent).toContain("Upload File");
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
  it("opens the same shared Add menu from @ and + without inserting a mention", async () => {
    const onSelect = vi.fn();
    await mount({
      initialText: "",
      contextMenuItems: [{ id: "source", label: "Choose source", onSelect }],
    });
    const editor = container.querySelector<HTMLElement>(".ProseMirror")!;

    await act(async () => {
      editor.focus();
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "@",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const mentionMenu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(mentionMenu?.textContent).toContain("Upload File");
    expect(mentionMenu?.textContent).toContain("Choose source");
    expect(editor.textContent).toBe("");
    const mentionOptions = Array.from(
      mentionMenu!.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
    ).map((item) => item.textContent);

    const plusButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add context"]',
    )!;
    await act(async () =>
      mentionMenu!
        .querySelector<HTMLElement>('[role^="menuitem"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        ),
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () =>
      plusButton.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

    const plusMenu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(
      Array.from(
        plusMenu!.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
      ).map((item) => item.textContent),
    ).toEqual(mentionOptions);
    const sourceAction = Array.from(
      plusMenu!.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
    ).find((item) => item.textContent === "Choose source")!;
    await act(async () => sourceAction.click());
    expect(onSelect).toHaveBeenCalledOnce();
  });
  it.each(["@", "+"])(
    "opens the integration submenu from %s without changing the draft",
    async (trigger) => {
      const onSelect = vi.fn();
      await mount({
        initialText: "Keep my draft ",
        contextMenuItems: [
          {
            id: "integrations",
            label: "Integrations",
            picker: {
              searchPlaceholder: "Search integrations",
              items: [{ id: "github", title: "GitHub" }],
              onSelect,
            },
          },
        ],
      });
      const editor = container.querySelector<HTMLElement>(".ProseMirror")!;
      const button = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Add context"]',
      )!;
      await act(async () => {
        const target = trigger === "@" ? editor : button;
        target.focus();
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: trigger === "@" ? "@" : "ArrowDown",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      const integrations = document.querySelector<HTMLElement>(
        '[role="menuitem"][aria-haspopup="menu"]',
      )!;
      expect(integrations.textContent).toBe("Integrations");
      await act(async () => {
        integrations.focus();
        integrations.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowRight",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      const github = document.querySelector<HTMLElement>(
        '[role="menuitemcheckbox"]',
      )!;
      expect(github.textContent).toBe("GitHub");
      await act(async () => github.click());
      expect(onSelect).toHaveBeenCalledOnce();
      expect(editor.textContent).toBe("Keep my draft ");
      expect(document.querySelector('[role="menu"]')).toBeNull();
    },
  );
  it.each(["@", "+"])(
    "adds discovered references from %s and restores draft focus without submitting",
    async (trigger) => {
      const onReferencesChange = vi.fn();
      const { onSubmit } = await mount({
        initialText: "My draft ",
        contextMenuItems: [],
        includeDefaultMentionSearch: false,
        onReferencesChange,
        mentionItems: [
          {
            id: "agent:slides",
            label: "Slides",
            description: "Presentations in this workspace",
            section: "Connected Agents",
            source: "agent",
            refType: "agent",
            refId: "slides",
            refPath: "https://slides.example.test",
          },
        ],
      });
      const editor = container.querySelector<HTMLElement>(".ProseMirror")!;
      const target =
        trigger === "@"
          ? editor
          : container.querySelector<HTMLButtonElement>(
              'button[aria-label="Add context"]',
            )!;
      await act(async () => {
        target.focus();
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: trigger === "@" ? "@" : "ArrowDown",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      const row = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find(
        (item) => item.textContent === "SlidesPresentations in this workspace",
      )!;
      expect(row).toBeDefined();
      await act(async () => row.click());
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      expect(editor.textContent).toContain("My draft");
      expect(editor.textContent).toContain("Slides");
      expect(editor.textContent).not.toContain("@");
      expect(onReferencesChange).toHaveBeenLastCalledWith([
        expect.objectContaining({
          refType: "agent",
          refId: "slides",
          path: "https://slides.example.test",
        }),
      ]);
      expect(document.activeElement).toBe(editor);
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );
  it("keeps regular @ references when the shared Add menu is explicitly hidden", async () => {
    await mount({
      plusMenuMode: "hidden",
      initialText: "",
      mentionItems: [
        {
          id: "brief",
          label: "Project brief",
          source: "resource:workspace",
          refType: "file",
          refPath: "brief.md",
        },
      ],
      includeDefaultMentionSearch: false,
    });
    const editor = container.querySelector<HTMLElement>(".ProseMirror")!;

    await act(async () => {
      editor.focus();
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "@",
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(
      document.querySelector('[data-mention-index="0"]')?.textContent,
    ).toContain("Project brief");
  });
  it.each(["@", "/", "full", "terminal"] as const)(
    "keeps the %s panel anchored to its own composer during host resize and scroll",
    async (trigger) => {
      const observations: {
        target: Element;
        resize: () => void;
        disconnect: () => void;
      }[] = [];
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(private resize: () => void) {}
          observe(target: Element) {
            observations.push({
              target,
              resize: this.resize,
              disconnect: this.disconnect,
            });
          }
          unobserve() {}
          disconnect = vi.fn();
        },
      );
      const plusMenu = trigger === "full" || trigger === "terminal";
      await mount({
        initialText: "",
        includeDefaultMentionSearch: false,
        plusMenuMode: plusMenu ? trigger : "hidden",
        terminalModeControl: { enabled: false, onChange: vi.fn() },
      });
      const editor = container.querySelector<HTMLElement>(".ProseMirror")!;
      const frame = editor.closest<HTMLElement>(
        '[data-agent-composer-slot="root"]',
      )!;
      let bounds = { x: 100, y: 300, width: 700, height: 150 };
      vi.spyOn(frame, "getBoundingClientRect").mockImplementation(() =>
        DOMRect.fromRect(bounds),
      );
      // A wider ancestor must not override the narrower composer that owns the panel.
      container.dataset.agentComposerSlot = "root";
      vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
        DOMRect.fromRect({ width: 1000 }),
      );
      await act(async () => {
        if (plusMenu) {
          container
            .querySelector<HTMLButtonElement>(
              'button[aria-label="Add context"]',
            )!
            .dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "ArrowDown",
                bubbles: true,
                cancelable: true,
              }),
            );
        } else {
          editor.focus();
          editor.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: trigger,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const panel = document.querySelector<HTMLElement>(
        '[data-agent-native-composer-popover="true"]',
      )!;
      expect(panel).not.toBeNull();
      expect(panel.style.width).toBe("700px");
      const observation = observations.find(({ target }) => target === frame)!;
      expect(observation).toBeDefined();
      for (const width of [324, 280, 700]) {
        bounds = { ...bounds, width };
        await act(async () => observation.resize());
        expect(panel.style.width).toBe(`${width}px`);
        if (!plusMenu) expect(panel.style.left).toBe("100px");
      }
      bounds = { ...bounds, x: 120, y: 160 };
      await act(async () => window.dispatchEvent(new Event("scroll")));
      if (!plusMenu) {
        expect(panel.style.left).toBe("120px");
        expect(panel.style.bottom).toContain("160px");
      }
      expect(panel.style.maxHeight).toBe("136px");
      await act(async () =>
        editor.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(
        document.querySelector('[data-agent-native-composer-popover="true"]'),
      ).toBeNull();
      expect(observation.disconnect).toHaveBeenCalled();
      vi.restoreAllMocks();
    },
  );
  it("requests storage setup only after choosing Upload File", async () => {
    const onAttachmentRequest = vi.fn();
    await mount({
      attachmentsEnabled: false,
      plusMenuMode: "full",
      onAttachmentRequest,
    });
    expect(onAttachmentRequest).not.toHaveBeenCalled();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[data-agent-composer-slot="plus-button"]',
        )!
        .dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowDown",
            bubbles: true,
            cancelable: true,
          }),
        );
    });
    const uploadFile = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((button) => button.textContent?.includes("Upload File"));
    expect(uploadFile).toBeDefined();
    await act(async () => uploadFile!.click());

    expect(onAttachmentRequest).toHaveBeenCalledOnce();
  });

  it("requests storage setup from the upload-only button", async () => {
    const onAttachmentRequest = vi.fn();
    await mount({
      attachmentsEnabled: false,
      onAttachmentRequest,
      plusMenuMode: "upload-only",
    });

    expect(onAttachmentRequest).not.toHaveBeenCalled();
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add context"]',
    )!;
    await act(async () =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    const uploadFile = document.querySelector<HTMLElement>('[role="menuitem"]');
    expect(uploadFile).toBeDefined();
    expect(uploadFile?.textContent).toContain("Upload File");
    await act(async () => uploadFile!.click());
    expect(onAttachmentRequest).toHaveBeenCalledOnce();
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

  async function attachFile(name = "reference.pdf") {
    const file = new File([`example ${name}`], name, {
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

  it.each([
    ["reference.pdf", "application/pdf"],
    ["reference.png", "image/png"],
    ["reference.txt", "text/plain"],
  ])(
    "keeps two different uploads named %s independently removable",
    async (name, type) => {
      let files: PromptComposerFile[] = [];
      const { composerRef } = await mount({
        onAttachmentsChange: (next) => {
          files = next;
        },
      });
      const first = new File(["first"], name, { type });
      const second = new File(["second"], name, { type });
      await act(async () => {
        await composerRef.current!.addAttachment(first);
        await composerRef.current!.addAttachment(second);
      });
      expect(files).toEqual([first, second]);
      const remove = container.querySelectorAll<HTMLElement>(
        `[aria-label="Remove ${name}"]`,
      );
      expect(remove).toHaveLength(2);
      await act(async () => remove[0].click());
      expect(files).toEqual([second]);
    },
  );

  it.each(["@", "/"])(
    "closes an open %s panel when the editor is disabled",
    async (key) => {
      const props = {
        initialText: "",
        includeDefaultMentionSearch: false,
        plusMenuMode: "hidden" as const,
      };
      await mount(props);
      const editor = container.querySelector<HTMLElement>(".ProseMirror")!;
      await act(async () => {
        editor.focus();
        editor.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(
        document.querySelector('[data-agent-native-composer-popover="true"]'),
      ).not.toBeNull();
      await mount({ ...props, disabled: true });
      expect(
        document.querySelector('[data-agent-native-composer-popover="true"]'),
      ).toBeNull();
    },
  );

  it("reclamps mention panels when only the viewport width changes", async () => {
    const previousWidth = window.innerWidth;
    await mount({
      initialText: "",
      includeDefaultMentionSearch: false,
      plusMenuMode: "hidden",
    });
    const editor = container.querySelector<HTMLElement>(".ProseMirror")!;
    const frame = editor.closest<HTMLElement>(
      '[data-agent-composer-slot="root"]',
    )!;
    const measure = vi
      .spyOn(frame, "getBoundingClientRect")
      .mockReturnValue(
        DOMRect.fromRect({ x: 100, y: 300, width: 700, height: 150 }),
      );
    try {
      await act(async () => {
        editor.focus();
        editor.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "@",
            bubbles: true,
            cancelable: true,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const panel = document.querySelector<HTMLElement>(
        '[data-agent-native-composer-popover="true"]',
      )!;
      await act(async () => {
        window.innerWidth = 324;
        window.dispatchEvent(new Event("resize"));
      });
      expect(panel.style.width).toBe("292px");
      expect(panel.style.left).toBe("16px");
    } finally {
      window.innerWidth = previousWidth;
      measure.mockRestore();
    }
  });

  it("reports a rejected submit preparation and retains the draft for retry", async () => {
    const onBeforeSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("Preparation failed"))
      .mockResolvedValueOnce(true);
    const { composerRef, onSubmit } = await mount({ onBeforeSubmit });
    await act(async () =>
      expect(await composerRef.current!.submitWithText("Ready")).toBe(false),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Preparation failed",
    );
    expect(container.querySelector(".ProseMirror")?.textContent).toBe(
      "Keep the editable draft",
    );
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () =>
      expect(await composerRef.current!.submitWithText("Ready")).toBe(true),
    );
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it.each(["host", "provider"] as const)(
    "%s submission gating prevents sends until ready",
    async (gate) => {
      const composerRef = React.createRef<TiptapComposerHandle>();
      const onSubmit = vi.fn();
      const onSelect = vi.fn();
      const onRemove = vi.fn();
      const onRetry = vi.fn();
      const onDisabledClick = vi.fn();
      const onAttachmentRequest = vi.fn();
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
                attachmentsEnabled={!(gate === "provider" && blocked)}
                onAttachmentRequest={onAttachmentRequest}
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
      if (gate === "provider") {
        expect(
          container.querySelector('[data-testid="provider-setup"]'),
        ).not.toBeNull();
        expect(
          container.querySelector('[contenteditable="true"]'),
        ).not.toBeNull();
        const uploadTrigger = container.querySelector<HTMLButtonElement>(
          'button[aria-label="Add context"]',
        )!;
        expect(uploadTrigger).not.toBeNull();
        expect(uploadTrigger.disabled).toBe(true);
        expect(
          container
            .querySelector('[role="textbox"]')
            ?.getAttribute("aria-disabled"),
        ).toBe("true");
        await act(async () =>
          uploadTrigger.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
          ),
        );
        expect(document.querySelector('[role="menu"]')).toBeNull();
        expect(onAttachmentRequest).not.toHaveBeenCalled();
        expect(
          container.querySelector<HTMLButtonElement>(
            'button[aria-label="Send message"]',
          )?.disabled,
        ).toBe(true);
        await act(async () =>
          expect(
            await composerRef.current!.submitWithText("Blocked prompt"),
          ).toBe(false),
        );
        expect(onSubmit).not.toHaveBeenCalled();
        expect(onDisabledClick).not.toHaveBeenCalled();
        blocked = false;
        await render();
      }
      const editor = container.querySelector<HTMLElement>(
        '[contenteditable="true"]',
      )!;
      expect(editor).not.toBeNull();
      expect(editor.getAttribute("aria-disabled")).toBe("false");
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
      const option = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((element) => element.textContent?.includes("Choose brief"))!;
      expect(option).toBeDefined();
      await act(async () => option.click());
      expect(onSelect).toHaveBeenCalledOnce();
      const contextRow = container.querySelector('[data-context-key="brief"]');
      expect(contextRow?.querySelectorAll("button")).toHaveLength(1);
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Remove Brief context"]',
          )!
          .click();
      });
      expect(onRetry).not.toHaveBeenCalled();
      expect(onRemove).toHaveBeenCalledWith("brief");
      expect(onDisabledClick).not.toHaveBeenCalled();
      const send = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Send message"]',
      )!;
      if (gate === "host") {
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
      } else {
        expect(send.disabled).toBe(false);
      }
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
    const onAttachmentRequest = vi.fn();
    const { composerRef, onSubmit } = await mount({
      disabled: true,
      onAttachmentRequest,
      contextMenuItems: [
        { id: "brief", label: "Choose brief", onSelect: vi.fn() },
      ],
    });
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(
      container
        .querySelector('[role="textbox"]')
        ?.getAttribute("aria-disabled"),
    ).toBe("true");
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
    expect(onAttachmentRequest).not.toHaveBeenCalled();
  });

  it.each(["disabled", "submissionDisabled", "submitting"] as const)(
    "rechecks %s after async submit preparation and rejects duplicate submissions",
    async (gate) => {
      let release!: (allowed: boolean) => void;
      const pending = new Promise<boolean>((resolve) => {
        release = resolve;
      });
      const onBeforeSubmit = vi.fn(() => pending);
      const onSubmit = vi.fn();
      const composerRef = React.createRef<TiptapComposerHandle>();
      const props = { onBeforeSubmit, onSubmit, composerRef };
      await mount(props);
      let submission!: Promise<boolean>;
      await act(async () => {
        submission = composerRef.current!.submitWithText("Ready to send");
        expect(await composerRef.current!.submitWithText("Duplicate")).toBe(
          false,
        );
      });
      expect(onBeforeSubmit).toHaveBeenCalledOnce();
      await mount({ ...props, [gate]: true });
      await act(async () => {
        release(true);
        expect(await submission).toBe(false);
      });
      expect(onSubmit).not.toHaveBeenCalled();
      expect(container.querySelector(".ProseMirror")?.textContent).toBe(
        "Keep the editable draft",
      );
    },
  );

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

  it("keeps the draft editable and blocks submission while provider status is unresolved", async () => {
    const composerRef = React.createRef<TiptapComposerHandle>();
    const onSubmit = vi.fn();
    await act(async () =>
      root.render(
        <ComposerRuntimeAdaptersProvider
          adapters={{
            models: {
              useAgentEngineConfigured: () => ({
                state: "unknown",
                missing: false,
              }),
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
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      container.querySelector('[contenteditable="true"]')?.textContent,
    ).toBe("Keep my draft");
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).not.toContain("checkingProvider");
    const sendButton = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="send-button"]',
    );
    expect(sendButton?.disabled).toBe(true);
    expect(sendButton?.getAttribute("aria-busy")).toBeNull();
    expect(sendButton?.getAttribute("aria-label")).not.toBe("common.loading");
    expect(sendButton?.querySelector(".animate-spin")).toBeNull();
  });

  it("lets a host queue submissions while provider status is unresolved", async () => {
    const composerRef = React.createRef<TiptapComposerHandle>();
    const onBeforeSubmit = vi.fn(async () => true);
    const onSubmit = vi.fn();
    await act(async () =>
      root.render(
        <ComposerRuntimeAdaptersProvider
          adapters={{
            models: {
              useAgentEngineConfigured: () => ({
                state: "unknown",
                missing: false,
              }),
            },
          }}
        >
          <PromptComposer
            composerRef={composerRef}
            onBeforeSubmit={onBeforeSubmit}
            onSubmit={onSubmit}
            initialText="Queue this message"
            initialTextKey="queued-provider-submit"
            requireAgentEngine={false}
            showModelSelector={false}
            includeDefaultSlashSkills={false}
          />
        </ComposerRuntimeAdaptersProvider>,
      ),
    );

    await act(async () =>
      expect(
        await composerRef.current!.submitWithText("Queue this message"),
      ).toBe(true),
    );

    expect(onBeforeSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("submits edits made while an async readiness check is pending", async () => {
    let resolveReadiness!: (ready: boolean) => void;
    const readiness = new Promise<boolean>((resolve) => {
      resolveReadiness = resolve;
    });
    let resolveSubmit!: () => void;
    const submission = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    const onBeforeSubmit = vi.fn(() => readiness);
    const { composerRef, onSubmit } = await mount({ onBeforeSubmit });
    onSubmit.mockReturnValue(submission);
    const editor = container.querySelector<HTMLElement>(
      '[contenteditable="true"]',
    )!;

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!
        .click();
    });
    expect(onBeforeSubmit).toHaveBeenCalledOnce();

    await act(async () =>
      composerRef.current!.setText("Updated while checking readiness"),
    );
    await act(async () => {
      resolveReadiness(true);
      await readiness;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toBe("Updated while checking readiness");
    await act(async () => composerRef.current!.setText("Next draft"));
    await act(async () => {
      resolveSubmit();
      await submission;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(editor.textContent).toBe("Next draft");
  });

  it("uses context items updated during the readiness check", async () => {
    let resolveReadiness!: (ready: boolean) => void;
    const readiness = new Promise<boolean>((resolve) => {
      resolveReadiness = resolve;
    });
    const initialContext: AgentChatContextItem = {
      key: "source:initial",
      title: "Initial source",
      context: "initial source",
    };
    const updatedContext: AgentChatContextItem = {
      key: "source:updated",
      title: "Updated source",
      context: "updated source",
    };
    let updateContextItems!: React.Dispatch<
      React.SetStateAction<AgentChatContextItem[]>
    >;
    const onBeforeSubmit = vi.fn(() => readiness);
    const onSubmit = vi.fn();
    const composerRef = React.createRef<TiptapComposerHandle>();
    function ContextPrompt() {
      const [contextItems, setContextItems] = React.useState([initialContext]);
      updateContextItems = setContextItems;
      return (
        <PromptComposer
          composerRef={composerRef}
          onSubmit={onSubmit}
          onBeforeSubmit={onBeforeSubmit}
          contextItems={contextItems}
          initialText="Submit with current context"
          initialTextKey="context-refresh"
          showModelSelector={false}
          modelStatusChecksEnabled={false}
          includeDefaultSlashSkills={false}
          voiceEnabled={false}
        />
      );
    }

    await act(async () => root.render(<ContextPrompt />));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onBeforeSubmit).toHaveBeenCalledOnce();

    await act(async () => updateContextItems([updatedContext]));
    await act(async () => {
      resolveReadiness(true);
      await readiness;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][3].contextItems).toEqual([updatedContext]);
  });

  it("uses the latest host submit callback after readiness resolves", async () => {
    let resolveReadiness!: (ready: boolean) => void;
    const readiness = new Promise<boolean>((resolve) => {
      resolveReadiness = resolve;
    });
    let updateSelection!: React.Dispatch<React.SetStateAction<string>>;
    const initialSubmit = vi.fn();
    const updatedSubmit = vi.fn();
    const composerRef = React.createRef<TiptapComposerHandle>();
    const onBeforeSubmit = vi.fn(() => readiness);
    function SelectionPrompt() {
      const [selection, setSelection] = React.useState("initial");
      updateSelection = setSelection;
      return (
        <PromptComposer
          composerRef={composerRef}
          onSubmit={(text) =>
            (selection === "initial" ? initialSubmit : updatedSubmit)(text)
          }
          onBeforeSubmit={onBeforeSubmit}
          initialText="Submit after selection changes"
          initialTextKey="selection-refresh"
          showModelSelector={false}
          modelStatusChecksEnabled={false}
          includeDefaultSlashSkills={false}
          voiceEnabled={false}
        />
      );
    }

    await act(async () => root.render(<SelectionPrompt />));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onBeforeSubmit).toHaveBeenCalledOnce();

    await act(async () => updateSelection("updated"));
    await act(async () => {
      resolveReadiness(true);
      await readiness;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(initialSubmit).not.toHaveBeenCalled();
    expect(updatedSubmit).toHaveBeenCalledOnce();
    expect(updatedSubmit).toHaveBeenCalledWith(
      "Submit after selection changes",
    );
  });

  it.each([
    ["in the same paragraph", " "],
    ["in a new paragraph", "\n"],
  ])(
    "removes an appended submitted prompt and keeps a follow-up $0",
    async (_placement, separator) => {
      let resolveSubmit!: () => void;
      const submission = new Promise<void>((resolve) => {
        resolveSubmit = resolve;
      });
      const { composerRef, onSubmit } = await mount({
        initialText: "Submitted prompt",
        initialTextKey: "submitted-prefix-follow-up",
      });
      onSubmit.mockReturnValue(submission);

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Send message"]',
          )!
          .click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(onSubmit).toHaveBeenCalledOnce();

      await act(async () =>
        composerRef.current!.setText(`Submitted prompt${separator}Follow-up`),
      );
      expect(
        container.querySelector('[contenteditable="true"]')?.textContent,
      ).toBe(`Submitted prompt${separator === "\n" ? "" : " "}Follow-up`);
      const editor = container.querySelector<HTMLElement>(
        '[contenteditable="true"]',
      )!;
      await act(async () => {
        resolveSubmit();
        await submission;
        for (
          let attempt = 0;
          attempt < 10 && editor.textContent !== "Follow-up";
          attempt++
        ) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      });

      expect(editor.textContent?.trim()).toBe("Follow-up");
    },
  );

  it("cleans submitted attachments and keeps later attachment and reference edits", async () => {
    let resolveSubmit!: () => void;
    const submission = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    let currentFiles: File[] = [];
    const { composerRef, onSubmit } = await mount({
      onAttachmentsChange: (files) => {
        currentFiles = files;
      },
    });
    onSubmit.mockReturnValue(submission);
    const submittedFile = await attachFile("reference.pdf");
    const otherSubmittedFile = await attachFile("submitted.pdf");
    await act(async () =>
      composerRef.current!.insertReference({
        label: "Submitted reference",
        refType: "file",
        refId: "submitted-reference",
        slotKey: "document",
      }),
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][2]).toContainEqual(
      expect.objectContaining({
        refId: "submitted-reference",
        slotKey: "document",
      }),
    );
    expect(onSubmit.mock.calls[0][3].attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: submittedFile }),
        expect.objectContaining({ file: otherSubmittedFile }),
      ]),
    );

    const replacementFile = await attachFile("reference.pdf");
    const laterFile = await attachFile("later-reference.pdf");
    await act(async () => {
      composerRef.current!.setText("Next draft");
      composerRef.current!.insertReference({
        label: "Later reference",
        refType: "file",
        refId: "later-reference",
        slotKey: "document",
      });
    });

    await act(async () => {
      resolveSubmit();
      await submission;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(currentFiles).toEqual([replacementFile, laterFile]);
    expect(
      container.querySelector('[contenteditable="true"]')?.textContent,
    ).toBe("Next draft");
    expect(container.textContent).toContain("Later reference");
    expect(container.textContent).not.toContain("Submitted reference");
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
  it("renders a noninteractive context chip with only removal and blocks submission until ready", async () => {
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
    expect(contextRow.className).toContain("py-0.5");
    expect(contextRow.querySelector("span")?.textContent).toBe("Brief");
    expect(contextRow.querySelectorAll("button")).toHaveLength(1);
    expect(
      contextRow.querySelector('[aria-label="Context failed"]'),
    ).not.toBeNull();
    await act(async () => {
      contextRow
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Remove Brief context"]',
        )!
        .click();
    });
    expect(onInspectContextItem).not.toHaveBeenCalled();
    expect(onRetryContextItem).not.toHaveBeenCalled();
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
