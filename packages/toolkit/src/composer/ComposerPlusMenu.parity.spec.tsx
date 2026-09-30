// @vitest-environment happy-dom

import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import { mergeComposerMenuItems } from "./ComposerPlusMenu.js";
import { PromptComposer, type PromptComposerProps } from "./PromptComposer.js";
import type { PromptComposerSubmitOptions } from "./PromptComposer.js";
import {
  ComposerRuntimeAdaptersProvider,
  type ComposerRuntimeAdapters,
} from "./runtime-adapters.js";
import { TiptapComposer, type TiptapComposerHandle } from "./TiptapComposer.js";

let root: Root;
let container: HTMLDivElement;
let adapters: ComposerRuntimeAdapters;
const useOrg = vi.fn(() => ({ data: { orgId: "test-org", role: "member" } }));
const mutateAsync = vi.fn(async (_input: unknown) => ({}));
const useCreateMcpServer = vi.fn(() => ({ mutateAsync }));
const isMcpIntegrationAvailable = vi.fn(() => true);
const sendToAgentChat = vi.fn();
const setContextItem = vi.fn();
const dialogProps = vi.fn();

function McpDialog(props: Record<string, any>) {
  dialogProps(props);
  return props.open ? (
    <div role="dialog">
      <button onClick={() => props.onCreateMcpServer({ name: "test-server" })}>
        Configure test integration
      </button>
      <button onClick={() => props.onOpenChange(false)}>
        Close test integration
      </button>
    </div>
  ) : null;
}

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
      useOrg,
      useCreateMcpServer,
      isMcpIntegrationAvailable,
      McpIntegrationDialog: McpDialog,
    },
    agentChat: { sendToAgentChat, setContextItem },
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

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
async function mount(props: Partial<PromptComposerProps> = {}) {
  const composerRef = React.createRef<TiptapComposerHandle>();
  const onSubmit = vi.fn();
  await act(async () => {
    root.render(
      <ComposerRuntimeAdaptersProvider adapters={adapters}>
        <PromptComposer
          composerRef={composerRef}
          onSubmit={onSubmit}
          initialText="Draft "
          initialTextKey="parity"
          plusMenuMode="full"
          showModelSelector={false}
          modelStatusChecksEnabled={false}
          includeDefaultMentionSearch={false}
          includeDefaultSlashSkills={false}
          voiceEnabled={false}
          {...props}
        />
      </ComposerRuntimeAdaptersProvider>,
    );
    await settle();
  });
  return { composerRef, onSubmit };
}
async function open(trigger: "+" | "@") {
  const target =
    trigger === "+"
      ? container.querySelector<HTMLElement>('button[aria-label="Add context"]')
      : container.querySelector<HTMLElement>(".ProseMirror");
  expect(target).not.toBeNull();
  await act(async () => {
    target!.focus();
    target!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: trigger === "+" ? "ArrowDown" : "@",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
  });
  if (
    document.querySelector('[role="menuitem"]') &&
    labels().includes("Add context")
  )
    await choose("Add context");
}
function item(label: string) {
  const row = Array.from(
    document.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
  ).find((row) => row.textContent?.trim() === label);
  expect(row, label).toBeDefined();
  return row!;
}
async function choose(label: string) {
  await act(async () => {
    const row = item(label);
    row.focus();
    if (row.getAttribute("aria-haspopup") === "menu")
      row.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
    else row.click();
    await settle();
  });
}
async function close() {
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
  });
}
function labels() {
  return Array.from(document.querySelectorAll('[role^="menuitem"]')).map(
    (row) => row.textContent?.trim(),
  );
}
async function uploadSkill() {
  await choose("Create Skill");
  await choose("Upload skill file");
  const input = container.querySelector<HTMLInputElement>(
    'input[accept=".md,text/markdown"]',
  )!;
  const file = new File(["# Test skill\nDo the test."], "Test Skill.md", {
    type: "text/markdown",
  });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
  });
  return document.querySelector<HTMLFormElement>('[role="menu"] form')!;
}

describe("shared default action preservation", () => {
  it("preserves host action IDs and replaces defaults even inside a capability group", () => {
    const defaults = [
      { id: "integrations", label: "Setup", onSelect: vi.fn() },
      { id: "create-skill", label: "Skill", onSelect: vi.fn() },
    ];
    const provided = [
      {
        id: "capabilities",
        label: "Capabilities",
        children: [
          { id: "integrations", label: "Integrations", onSelect: vi.fn() },
        ],
      },
    ];
    const merged = mergeComposerMenuItems(defaults, provided);
    expect(merged).toEqual([provided[0], defaults[1]]);
    expect(merged[0]).toBe(provided[0]);
  });

  for (const trigger of ["+", "@"] as const) {
    it.each(["full", "upload-only", "terminal", "hidden"] as const)(
      `${trigger} respects %s action and resource gates`,
      async (mode) => {
        const onChange = vi.fn();
        await mount({
          plusMenuMode: mode,
          terminalModeControl: { enabled: false, onChange },
        });
        if (mode === "hidden") {
          expect(
            container.querySelector('button[aria-label="Add context"]'),
          ).toBeNull();
          if (trigger === "@") {
            await open(trigger);
            expect(document.querySelector('[role="menu"]')).toBeNull();
          }
        } else {
          await open(trigger);
          const expected =
            mode === "full"
              ? [
                  "Upload File",
                  "Add context",
                  "Schedule Task",
                  "Create Automation",
                  "Integrations",
                  "Create Skill",
                ]
              : mode === "terminal"
                ? ["Add context", "New terminal", "CLI terminal mode"]
                : ["Upload File"];
          expect(labels()).toEqual(expected);
        }
        if (mode === "full") {
          expect(useOrg).toHaveBeenCalled();
          expect(useCreateMcpServer).toHaveBeenCalled();
        } else {
          expect(useOrg).not.toHaveBeenCalled();
          expect(useCreateMcpServer).not.toHaveBeenCalled();
          expect(isMcpIntegrationAvailable).not.toHaveBeenCalled();
        }
      },
    );

    it.each([
      ["Schedule Task", "Create a recurring job: Draft", "manage-jobs"],
      [
        "Create Automation",
        "Create an automation: Draft",
        "manage-automations",
      ],
      ["Create Extension", "Create an extension: Draft", "create-extension"],
      ["Create new skill", "Create a skill: Draft", "resources"],
    ])(
      `${trigger} submits %s instructions through the accepted host path`,
      async (action, message, context) => {
        const { composerRef, onSubmit } = await mount({
          contextMenuItems: [
            { id: "host", label: "Host source", onSelect: vi.fn() },
          ],
          extensionTools: true,
        });
        await open(trigger);
        expect(labels()).toContain("Host source");
        if (action === "Create new skill") await choose("Create Skill");
        await choose(action);
        expect(
          container.querySelector('[data-agent-composer-slot="mode-row"]'),
        ).not.toBeNull();
        await act(async () => {
          expect(await composerRef.current!.submitWithText("Draft")).toBe(true);
        });
        expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
          message,
          [],
          [],
          expect.objectContaining({
            composerModeContext: expect.stringContaining(context),
            intent: "immediate",
          }),
        );
        expect(sendToAgentChat).not.toHaveBeenCalled();
        expect(
          container.querySelector('[data-agent-composer-slot="mode-row"]'),
        ).toBeNull();
      },
    );

    it(`${trigger} clears automation mode through its accessible Cancel button`, async () => {
      const { composerRef, onSubmit } = await mount();
      await open(trigger);
      await choose("Create Automation");
      const cancel = container.querySelector<HTMLButtonElement>(
        '[data-agent-composer-slot="mode-row"] button[aria-label="Cancel"]',
      );
      expect(cancel).not.toBeNull();
      await act(async () => {
        cancel!.focus();
        cancel!.click();
      });
      expect(
        container.querySelector('[data-agent-composer-slot="mode-row"]'),
      ).toBeNull();
      expect(container.querySelector(".ProseMirror")?.textContent).toContain(
        "Draft",
      );
      expect(document.activeElement).toBe(
        container.querySelector(".ProseMirror"),
      );
      await act(async () => {
        expect(await composerRef.current!.submitWithText("Draft")).toBe(true);
      });
      expect(onSubmit.mock.calls[0][0]).toBe("Draft");
      expect(onSubmit.mock.calls[0][3]).not.toHaveProperty(
        "composerModeContext",
      );
      expect(sendToAgentChat).not.toHaveBeenCalled();
    });

    it(`${trigger} uses host Integrations, without abandoning its configuration action`, async () => {
      const configure = vi.fn();
      await mount({
        contextMenuItems: [
          {
            id: "integrations",
            label: "Integrations",
            children: [
              { id: "connect", label: "Connect / Manage", onSelect: configure },
            ],
          },
        ],
      });
      await open(trigger);
      expect(labels().filter((label) => label === "Integrations")).toHaveLength(
        1,
      );
      await choose("Integrations");
      await choose("Connect / Manage");
      expect(configure).toHaveBeenCalledOnce();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it(`${trigger} preserves native upload and storage-setup handoff`, async () => {
      const onAttachmentRequest = vi.fn();
      await mount({ attachmentsEnabled: false, onAttachmentRequest });
      await open(trigger);
      expect(onAttachmentRequest).not.toHaveBeenCalled();
      await choose("Upload File");
      await act(async () => {
        await new Promise(requestAnimationFrame);
      });
      expect(onAttachmentRequest).toHaveBeenCalledOnce();
      await mount({ attachmentsEnabled: false });
      await open(trigger);
      expect(labels()).not.toContain("Upload File");
      await close();
      await mount();
      const input = container.querySelector<HTMLInputElement>(
        'input[type="file"][multiple]',
      )!;
      const click = vi.spyOn(input, "click").mockImplementation(() => {});
      await open(trigger);
      await choose("Upload File");
      expect(click).toHaveBeenCalledOnce();
    });

    it(`${trigger} retains terminal creation and checked mode controls`, async () => {
      const onChange = vi.fn();
      const onNewTerminal = vi.fn();
      await mount({
        plusMenuMode: "terminal",
        terminalModeControl: { enabled: false, onChange, onNewTerminal },
      });
      await open(trigger);
      await choose("New terminal");
      expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
      expect(onNewTerminal).not.toHaveBeenCalled();
      await mount({
        plusMenuMode: "terminal",
        terminalModeControl: { enabled: true, onChange, onNewTerminal },
      });
      await open(trigger);
      expect(item("CLI terminal mode").getAttribute("aria-checked")).toBe(
        "true",
      );
      await choose("New terminal");
      expect(onNewTerminal).toHaveBeenCalledOnce();
      await open(trigger);
      await choose("CLI terminal mode");
      expect(onChange).toHaveBeenLastCalledWith(false);
      expect(useOrg).not.toHaveBeenCalled();
    });

    it(`${trigger} keeps the skill filename, review, save payload, and duplicate-save lock`, async () => {
      let resolve!: (response: Response) => void;
      const fetch = vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      );
      vi.stubGlobal("fetch", fetch);
      await mount();
      await open(trigger);
      const form = await uploadSkill();
      expect(form).not.toBeNull();
      expect(form.textContent).toContain(
        "Review the content from Test Skill.md before saving.",
      );
      expect(form.textContent).toContain("skills/test-skill/SKILL.md");
      expect(form.querySelector("textarea")?.value).toBe(
        "# Test skill\nDo the test.",
      );
      await act(async () => {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        await settle();
      });
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        "/test-app/_agent-native/resources",
        expect.objectContaining({
          method: "POST",
          signal: expect.any(AbortSignal),
          body: JSON.stringify({
            path: "skills/test-skill/SKILL.md",
            content: "# Test skill\nDo the test.",
            mimeType: "text/markdown",
            shared: false,
          }),
        }),
      );
      await act(async () => {
        resolve(new Response("{}"));
        await settle();
      });
      expect(form.querySelector('[role="status"]')?.textContent).toContain(
        'Skill "Test Skill.md" added',
      );
    });
  }

  it("keeps explicit hidden host menus lightweight and preserves the host action", async () => {
    const onSelect = vi.fn();
    await mount({
      plusMenuMode: "hidden",
      contextMenuItems: [{ id: "host", label: "Host source", onSelect }],
    });
    await open("@");
    expect(labels()).toEqual(["Upload File", "Add context", "Host source"]);
    await choose("Host source");
    expect(onSelect).toHaveBeenCalledOnce();
    expect(useOrg).not.toHaveBeenCalled();
  });

  it("retains the raw Tiptap mode bridge only when no host submission handler exists", async () => {
    const composerRef = React.createRef<TiptapComposerHandle>();
    function RawHost() {
      const runtime = useLocalRuntime({ async *run() {} });
      return (
        <ComposerRuntimeAdaptersProvider adapters={adapters}>
          <AssistantRuntimeProvider runtime={runtime}>
            <TooltipProvider>
              <TiptapComposer
                focusRef={composerRef}
                initialText="Draft "
                includeDefaultMentionSearch={false}
                includeDefaultSlashSkills={false}
                voiceEnabled={false}
                plusMenuMode="full"
              />
            </TooltipProvider>
          </AssistantRuntimeProvider>
        </ComposerRuntimeAdaptersProvider>
      );
    }
    await act(async () => {
      root.render(<RawHost />);
      await settle();
    });
    await open("+");
    await choose("Schedule Task");
    await act(async () => {
      expect(await composerRef.current!.submitWithText("Draft")).toBe(true);
    });
    expect(sendToAgentChat).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: "Create a recurring job: Draft",
        context: expect.stringContaining("manage-jobs"),
        submit: true,
      }),
    );
  });

  it("does not mount full actions while the model gate disables the composer", async () => {
    adapters.models = {
      useAgentEngineConfigured: () => ({ missing: true, state: "missing" }),
    };
    await mount({ modelStatusChecksEnabled: true });
    expect(useOrg).not.toHaveBeenCalled();
    expect(useCreateMcpServer).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "revalidates mode context through host acceptance and retains a revoked draft (files: %s)",
    async (withFile) => {
      const cached = {
        key: "integration:test-account",
        title: "Test integration",
        context: "Cached provider context",
      };
      const refreshed = { ...cached, context: "Refreshed provider context" };
      const prepareSubmission = vi
        .fn<(items: unknown) => Promise<(typeof cached)[]>>()
        .mockRejectedValueOnce(new Error("Integration access revoked"));
      let accept!: (items: (typeof cached)[]) => void;
      prepareSubmission.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            accept = resolve;
          }),
      );
      const acceptedSend = vi.fn();
      const onBeforeSubmit = vi.fn(async () => true);
      const hostSubmit = vi.fn(
        async (
          text: string,
          files: File[],
          _references: unknown,
          options: PromptComposerSubmitOptions,
        ) => {
          const prepared = await prepareSubmission(options.contextItems);
          acceptedSend({
            text,
            files,
            composerModeContext: options.composerModeContext,
            contextItems: prepared,
          });
        },
      );
      const composerRef = React.createRef<TiptapComposerHandle>();
      function Host() {
        const [contextItems, setContextItems] = React.useState<
          (typeof cached)[]
        >([]);
        return (
          <ComposerRuntimeAdaptersProvider adapters={adapters}>
            <PromptComposer
              composerRef={composerRef}
              onSubmit={hostSubmit}
              onBeforeSubmit={onBeforeSubmit}
              initialText="Draft "
              initialTextKey="mode-acceptance"
              plusMenuMode="full"
              contextItems={contextItems}
              contextMenuItems={[
                {
                  id: "attach-integration",
                  label: "Attach integration",
                  onSelect: () => setContextItems([cached]),
                },
              ]}
              inlineTextAttachments={false}
              showModelSelector={false}
              modelStatusChecksEnabled={false}
              includeDefaultMentionSearch={false}
              includeDefaultSlashSkills={false}
              voiceEnabled={false}
            />
          </ComposerRuntimeAdaptersProvider>
        );
      }
      await act(async () => {
        root.render(<Host />);
        await settle();
      });
      await open("@");
      await choose("Attach integration");
      await open("+");
      await choose("Schedule Task");
      const file = new File(["test document"], "reference.pdf", {
        type: "application/pdf",
      });
      if (withFile)
        await act(async () => {
          await composerRef.current!.addAttachment(file);
        });
      await act(async () => {
        expect(await composerRef.current!.submitWithText("Draft")).toBe(false);
      });
      expect(prepareSubmission).toHaveBeenCalledExactlyOnceWith([cached]);
      expect(acceptedSend).not.toHaveBeenCalled();
      expect(sendToAgentChat).not.toHaveBeenCalled();
      expect(container.querySelector(".ProseMirror")?.textContent).toContain(
        "Draft",
      );
      expect(
        container.querySelector('[data-agent-composer-slot="mode-row"]'),
      ).not.toBeNull();
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        "Integration access revoked",
      );
      if (withFile)
        expect(
          container.querySelector('[aria-label="Remove reference.pdf"]'),
        ).not.toBeNull();
      let pending!: Promise<boolean>;
      await act(async () => {
        pending = composerRef.current!.submitWithText("Draft");
        await settle();
      });
      await act(async () => {
        expect(await composerRef.current!.submitWithText("Duplicate")).toBe(
          false,
        );
      });
      expect(container.querySelector(".ProseMirror")?.textContent).toContain(
        "Draft",
      );
      expect(acceptedSend).not.toHaveBeenCalled();
      expect(onBeforeSubmit).toHaveBeenCalledTimes(2);
      await act(async () => {
        accept([refreshed]);
        expect(await pending).toBe(true);
      });
      expect(acceptedSend).toHaveBeenCalledExactlyOnceWith({
        text: "Create a recurring job: Draft",
        files: withFile ? [file] : [],
        composerModeContext: expect.stringContaining("manage-jobs"),
        contextItems: [refreshed],
      });
      expect(sendToAgentChat).not.toHaveBeenCalled();
      expect(container.querySelector(".ProseMirror")?.textContent).toBe("");
      expect(
        container.querySelector('[data-agent-composer-slot="mode-row"]'),
      ).toBeNull();
      expect(
        container.querySelector('[aria-label="Remove reference.pdf"]'),
      ).toBeNull();
    },
  );

  it("retains the fallback MCP dialog, role gates, and existing creation adapter", async () => {
    await mount();
    await open("+");
    await choose("Integrations");
    expect(dialogProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true,
        defaultScope: "user",
        hasOrg: true,
        canCreateOrgMcp: false,
      }),
    );
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[role="dialog"] button')!
        .click();
      await settle();
    });
    expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
      name: "test-server",
    });
    await act(async () => {
      document
        .querySelectorAll<HTMLButtonElement>('[role="dialog"] button')[1]
        .click();
      await settle();
    });
    expect(document.activeElement).toBe(
      container.querySelector(".ProseMirror"),
    );
  });

  it("keeps creator actions in the regular menu and omits Generate Image", async () => {
    await mount();
    await open("+");
    expect(labels()).toContain("Schedule Task");
    expect(labels()).toContain("Create Automation");
    expect(labels()).toContain("Create Skill");
    expect(labels()).not.toContain("Generate Image");
  });

  it("cancels a skill save when its submenu closes and retains retry after errors", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("Save rejected", { status: 500 }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      );
    vi.stubGlobal("fetch", fetch);
    await mount();
    await open("+");
    const form = await uploadSkill();
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await settle();
    });
    expect(form.querySelector('[role="alert"]')?.textContent).toBe(
      "Save rejected",
    );
    expect(form.querySelector("textarea")?.value).toBe(
      "# Test skill\nDo the test.",
    );
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await settle();
    });
    const request = fetch.mock.calls[1][1] as RequestInit;
    await act(async () => {
      Array.from(form.querySelectorAll("button"))
        .find((button) => button.textContent === "Cancel")!
        .click();
      await settle();
    });
    expect(request.signal?.aborted).toBe(true);
    expect(document.querySelector('[role="menu"] form')).toBeNull();
    await act(async () => {
      resolve(new Response("{}"));
      await settle();
    });
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(item("Upload skill file")).toBeDefined();
  });
});
