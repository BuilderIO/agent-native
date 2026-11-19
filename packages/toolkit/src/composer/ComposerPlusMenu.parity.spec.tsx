// @vitest-environment happy-dom

import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { waitFor } from "@testing-library/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "../ui/dialog.js";
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
async function mount(
  props: Partial<PromptComposerProps> = {},
  settleAfterRender = true,
) {
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
    if (settleAfterRender) await settle();
  });
  return { composerRef, onSubmit };
}
async function open(_enterAddContext = false) {
  const target = container.querySelector<HTMLElement>(
    'button[aria-label="Add context"]',
  );
  expect(target).not.toBeNull();
  await act(async () => {
    target!.focus();
    target!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
  });
}
function item(label: string) {
  const row = Array.from(
    document.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
  )
    .reverse()
    .find((row) => row.textContent?.trim() === label);
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
  return document.querySelector<HTMLFormElement>('[role="dialog"] form')!;
}

describe("shared default action preservation", () => {
  it("preserves overridden actions at the shared command slot without empty host groups", () => {
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
    expect(merged).toEqual([provided[0].children[0], defaults[1]]);
  });

  it("keeps host context at the root and keeps nested integration overrides in their labeled section", async () => {
    const selectContext = vi.fn();
    const selectIntegration = vi.fn();
    await mount({
      contextMenuItems: [
        {
          id: "host-group",
          label: "Workspace",
          children: [
            {
              id: "reference",
              label: "Reference",
              icon: <svg data-testid="reference-icon" />,
              onSelect: selectContext,
            },
            {
              id: "integrations",
              label: "Use integration",
              order: -100,
              children: [
                {
                  id: "invoke",
                  label: "Invoke service",
                  intent: "invoke-integration",
                  onSelect: selectIntegration,
                },
              ],
            },
          ],
        },
      ],
    });
    await open();
    expect(labels()).toEqual([
      "Files and images",
      "Workspace",
      "Use integration",
      "Schedule Task",
      "Create Automation",
      "Create Skill",
      "Upload skill file",
    ]);
    await choose("Workspace");
    expect(
      item("Reference").querySelector('[data-testid="reference-icon"]'),
    ).not.toBeNull();
    expect(
      Array.from(document.querySelectorAll('[role="menu"]')).at(-1)
        ?.textContent,
    ).not.toContain("Use integration");
    await choose("Reference");
    expect(selectContext).toHaveBeenCalledOnce();
    await open();
    expect(
      document.querySelector('[role="group"][aria-labelledby]'),
    ).not.toBeNull();
    expect(labels()).toContain("Use integration");
    expect(
      labels().filter((label) => label === "Use integration"),
    ).toHaveLength(1);
    expect(labels()).not.toContain("Integrations");
    await choose("Use integration");
    await choose("Invoke service");
    expect(selectIntegration).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("preserves disabled ancestry when host commands replace defaults", async () => {
    await mount({
      contextMenuItems: [
        {
          id: "disabled",
          label: "Unavailable",
          disabled: true,
          children: [
            { id: "integrations", label: "Use integration", onSelect: vi.fn() },
          ],
        },
      ],
    });
    await open();
    expect(labels()).toEqual([
      "Files and images",
      "Use integration",
      "Schedule Task",
      "Create Automation",
      "Create Skill",
      "Upload skill file",
    ]);
    expect(item("Use integration").getAttribute("aria-disabled")).toBe("true");
  });

  it("routes nested integration commands separately from context siblings", async () => {
    const invoke = vi.fn();
    await mount({
      contextMenuItems: [
        {
          id: "workspace",
          label: "Workspace",
          children: [
            { id: "reference", label: "Reference", onSelect: vi.fn() },
            {
              id: "invoke",
              label: "Use service",
              intent: "invoke-integration",
              onSelect: invoke,
            },
          ],
        },
      ],
    });
    await open();
    await choose("Workspace");
    expect(labels()).toContain("Reference");
    expect(
      Array.from(document.querySelectorAll('[role="menu"]')).at(-1)
        ?.textContent,
    ).not.toContain("Use service");
    await act(async () =>
      item("Reference").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await choose("Use service");
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("distinguishes file uploads from saved file references", async () => {
    const { onSubmit, composerRef } = await mount({
      mentionItems: [
        {
          id: "other",
          label: "Other reference",
          source: "resource",
          refType: "custom",
          section: "Other",
        },
        {
          id: "connected",
          label: "Connected agent",
          source: "resource",
          refType: "agent",
          section: "Connected Agents",
        },
        {
          id: "agent",
          label: "Local agent",
          source: "resource",
          refType: "agent",
          section: "Agents",
        },
        {
          id: "brief",
          label: "Launch brief",
          source: "resource",
          refType: "file",
          refPath: "brief.md",
          section: "Files",
          icon: "file",
        },
      ],
    });
    await open();
    expect(labels()).toEqual([
      "Files and images",
      "Search workspace…",
      "Integrations",
      "Schedule Task",
      "Create Automation",
      "Create Skill",
      "Upload skill file",
    ]);
    await choose("Search workspace…");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((element) => element.textContent === "Launch brief")!;
    expect(option).toBeDefined();
    await act(async () => option.click());
    await act(async () => {
      await composerRef.current?.submit?.();
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.arrayContaining([
        expect.objectContaining({ name: "Launch brief", path: "brief.md" }),
      ]),
      expect.anything(),
    );
  });

  it.each(["full", "upload-only", "terminal", "hidden"] as const)(
    "+ respects %s action and resource gates",
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
      } else {
        await open();
        const expected =
          mode === "full"
            ? [
                "Files and images",
                "Integrations",
                "Schedule Task",
                "Create Automation",
                "Create Skill",
                "Upload skill file",
              ]
            : mode === "terminal"
              ? ["New terminal", "CLI terminal mode"]
              : ["Files and images"];
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

  it("hands focus to a contributed dialog and restores the draft only after it closes", async () => {
    adapters.resources!.useWorkspaceMenu = function useWorkspaceMenu({
      onRestoreFocus,
    }) {
      const [visible, setVisible] = React.useState(false);
      return {
        scopeKey: "one",
        items: [
          {
            id: "connect",
            label: "Connect workspace",
            section: "integrations",
            opensDialog: true,
            onSelect: () => setVisible(true),
          },
        ],
        overlays: (
          <Dialog open={visible} onOpenChange={setVisible}>
            <DialogContent
              aria-describedby={undefined}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                onRestoreFocus?.();
              }}
            >
              <DialogTitle>Connect workspace</DialogTitle>
              <button onClick={() => setVisible(false)}>
                Finish connection
              </button>
            </DialogContent>
          </Dialog>
        ),
      };
    };
    await mount();
    await open();
    await choose("Connect workspace");
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);
    await act(async () => {
      const done = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
      ).find((button) => button.textContent === "Finish connection");
      if (!done) throw new Error("Missing connection control");
      done.click();
      await settle();
    });
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        container.querySelector(".ProseMirror"),
      ),
    );
  });

  it.each(["full", "upload-only"] as const)(
    "merges workspace contributions into labeled groups in %s and inserts their references",
    async (mode) => {
      const useWorkspaceMenu = vi.fn(
        ({
          onSelectIntegration,
        }: {
          enabled: boolean;
          onSelectIntegration: (reference: {
            label: string;
            source: string;
            refType: string;
            refId: string;
          }) => void;
        }) => ({
          scopeKey: "org:one",
          items: [
            {
              id: "calendar",
              label: "Use calendar",
              section: "integrations" as const,
              onSelect: () =>
                onSelectIntegration({
                  label: "Calendar",
                  source: "workspace-integration",
                  refType: "integration",
                  refId: "calendar",
                }),
            },
          ],
        }),
      );
      adapters.resources!.useWorkspaceMenu = useWorkspaceMenu;
      const { composerRef, onSubmit } = await mount({
        plusMenuMode: mode,
        contextMenuItems: [
          {
            id: "brief",
            label: "Reference brief",
            section: "context",
            onSelect: vi.fn(),
          },
        ],
      });
      expect(useWorkspaceMenu).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: false }),
      );
      await open();
      expect(useWorkspaceMenu).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true }),
      );
      const groups = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="group"][aria-labelledby]',
        ),
      );
      expect(
        groups.map(
          (group) =>
            document.getElementById(group.getAttribute("aria-labelledby")!)
              ?.textContent,
        ),
      ).toEqual(
        mode === "full"
          ? ["Add context", "Integrations", "Commands"]
          : ["Add context", "Integrations"],
      );
      expect(groups[1].textContent).toContain("Use calendar");
      expect(groups[1].textContent).not.toContain("Reference brief");
      expect(labels()).not.toContain("Integrations");
      await choose("Use calendar");
      await act(async () => composerRef.current!.submit());
      expect(onSubmit.mock.calls[0][2]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            refType: "integration",
            refId: "calendar",
          }),
        ]),
      );
    },
  );

  it.each(["upload-only", "hidden"] as const)(
    "keeps contributed integration commands separate in %s without adding default modes",
    async (mode) => {
      const attach = vi.fn();
      const invoke = vi.fn();
      await mount({
        plusMenuMode: mode,
        contextMenuItems: [
          {
            id: "source",
            label: "Reference brief",
            order: 20,
            onSelect: attach,
          },
          {
            id: "workspace-tools",
            label: "Workspace tools",
            intent: "invoke-integration",
            children: [
              { id: "provider", label: "Connected provider", onSelect: invoke },
            ],
          },
        ],
      });
      await open();
      expect(labels()).toEqual([
        "Files and images",
        "Reference brief",
        "Workspace tools",
      ]);
      expect(labels()).toContain("Workspace tools");
      for (const label of [
        "Schedule Task",
        "Create Automation",
        "Create Skill",
        "Upload skill file",
        "Integrations",
      ])
        expect(labels()).not.toContain(label);
      await choose("Workspace tools");
      await choose("Connected provider");
      expect(invoke).toHaveBeenCalledOnce();
      expect(attach).not.toHaveBeenCalled();
      expect(useOrg).not.toHaveBeenCalled();
      await open();
      await choose("Reference brief");
      expect(attach).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["Schedule Task", "Create a recurring job: Draft", "manage-jobs"],
    ["Create Automation", "Create an automation: Draft", "manage-automations"],
    ["Create Extension", "Create an extension: Draft", "create-extension"],
    ["Create Skill", "Create a skill: Draft", "resources"],
  ])(
    "+ submits %s instructions through the accepted host path",
    async (action, message, context) => {
      const { composerRef, onSubmit } = await mount({
        contextMenuItems: [
          { id: "host", label: "Host source", onSelect: vi.fn() },
        ],
        extensionTools: true,
      });
      await open();
      expect(labels()).toContain("Host source");
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

  it("+ clears automation mode through its accessible Cancel button", async () => {
    const { composerRef, onSubmit } = await mount();
    await open();
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
    expect(onSubmit.mock.calls[0][3]).not.toHaveProperty("composerModeContext");
    expect(sendToAgentChat).not.toHaveBeenCalled();
  });

  it("+ uses host Integrations, without abandoning its configuration action", async () => {
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
    await open();
    expect(labels().filter((label) => label === "Integrations")).toHaveLength(
      1,
    );
    await choose("Integrations");
    await choose("Connect / Manage");
    expect(configure).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("+ preserves native upload and storage-setup handoff", async () => {
    const onAttachmentRequest = vi.fn();
    await mount({ attachmentsEnabled: false, onAttachmentRequest });
    await open();
    expect(onAttachmentRequest).not.toHaveBeenCalled();
    await choose("Files and images");
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(onAttachmentRequest).toHaveBeenCalledOnce();
    await mount({ attachmentsEnabled: false });
    await open();
    expect(labels()).not.toContain("Files and images");
    await close();
    await mount();
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"][multiple]',
    )!;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    await open();
    await choose("Files and images");
    expect(click).toHaveBeenCalledOnce();
  });

  it("+ retains terminal creation and checked mode controls", async () => {
    const onChange = vi.fn();
    const onNewTerminal = vi.fn();
    await mount({
      plusMenuMode: "terminal",
      terminalModeControl: { enabled: false, onChange, onNewTerminal },
    });
    await open();
    await choose("New terminal");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(onNewTerminal).not.toHaveBeenCalled();
    await mount({
      plusMenuMode: "terminal",
      terminalModeControl: { enabled: true, onChange, onNewTerminal },
    });
    await open();
    expect(item("CLI terminal mode").getAttribute("aria-checked")).toBe("true");
    await choose("New terminal");
    expect(onNewTerminal).toHaveBeenCalledOnce();
    await open();
    await choose("CLI terminal mode");
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(useOrg).not.toHaveBeenCalled();
  });

  it("+ keeps the skill filename, review, save payload, and duplicate-save lock", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    await mount();
    await open();
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
          uniqueSkillPath: true,
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

  it("keeps explicit hidden host menus lightweight and preserves the host action", async () => {
    const onSelect = vi.fn();
    await mount({
      plusMenuMode: "hidden",
      contextMenuItems: [{ id: "host", label: "Host source", onSelect }],
    });
    await open(true);
    expect(labels()).toEqual(["Files and images", "Host source"]);
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
    await open();
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
    await mount({ requireAgentEngine: true });
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
      await open(true);
      await choose("Attach integration");
      await open();
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
    await open();
    await choose("Integrations");
    expect(dialogProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true,
        defaultScope: "org",
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

  it("labels chat actions as Commands and keeps context at the root", async () => {
    await mount({
      contextMenuItems: [
        { id: "host-source", label: "Host source", onSelect: vi.fn() },
      ],
    });
    await open();
    expect(labels()).toEqual([
      "Files and images",
      "Host source",
      "Integrations",
      "Schedule Task",
      "Create Automation",
      "Create Skill",
      "Upload skill file",
    ]);
    expect(labels()).toContain("Schedule Task");
    expect(labels()).toContain("Create Automation");
    expect(labels()).toContain("Create Skill");
    expect(labels()).not.toContain("Generate Image");
    expect(labels()).toContain("Host source");
    expect(labels()).toContain("Host source");
    expect(labels()).toContain("Schedule Task");
  });

  it("cancels a skill save when its dialog closes and retains retry after errors", async () => {
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
    await open("+", false);
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
    expect(document.querySelector('[role="dialog"] form')).toBeNull();
    await act(async () => {
      resolve(new Response("{}"));
      await settle();
    });
    expect(
      document.querySelector('[role="status"]')?.textContent,
    ).not.toContain("added");
    await open();
    expect(item("Upload skill file")).toBeDefined();
  });

  it("opens skill-file review in a dialog after the native picker returns", async () => {
    await mount();
    await open();
    await choose("Upload skill file");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[accept=".md,text/markdown"]',
    )!;
    const file = new File(["# Test skill\nDo the test."], "Test Skill.md", {
      type: "text/markdown",
    });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
    });

    const form = document.querySelector<HTMLFormElement>("[role=dialog] form");
    expect(form).not.toBeNull();
    expect(form?.textContent).toContain(
      "Review the content from Test Skill.md before saving.",
    );
    expect(form?.querySelector("textarea")?.value).toBe(
      "# Test skill\nDo the test.",
    );
  });

  it("leaves the menu closed when the native picker is canceled", async () => {
    await mount();
    await open();
    await choose("Upload skill file");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[accept=".md,text/markdown"]',
    )!;
    await act(async () => {
      input.dispatchEvent(new Event("cancel"));
      await settle();
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes skill review and aborts its pending save when the composer is disabled", async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetch);
    await mount();
    await open();
    const form = await uploadSkill();
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await settle();
    });
    const request = fetch.mock.calls[0][1] as RequestInit;
    await mount({ disabled: true });
    expect(request.signal?.aborted).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
