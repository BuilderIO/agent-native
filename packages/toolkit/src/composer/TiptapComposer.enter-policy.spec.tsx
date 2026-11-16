// @vitest-environment happy-dom

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import enterPolicyOracleCases from "./TiptapComposer.enter-policy-cases.json";

vi.mock("./useRealtimeVoiceMode.js", () => ({
  RealtimeVoiceModeBoundary: ({ children }: { children: React.ReactNode }) =>
    children,
  useRealtimeVoiceModeCopy: () => ({ placeholder: "Speak to the agent..." }),
  useRealtimeVoiceModeOptional: () => null,
}));

import { TooltipProvider } from "../ui/tooltip.js";
import { PromptComposer, type PromptComposerProps } from "./PromptComposer.js";
import {
  ComposerEnterKeyContext,
  TiptapComposer,
  type ComposerEnterKey,
  type TiptapComposerHandle,
  type TiptapComposerProps,
} from "./TiptapComposer.js";

const emptyChatModelAdapter: ChatModelAdapter = { async *run() {} };

let container: HTMLDivElement;
let root: Root;
let focusRef: React.RefObject<TiptapComposerHandle | null>;

type TiptapSubmitSpy = ReturnType<typeof vi.fn> &
  NonNullable<TiptapComposerProps["onSubmit"]>;

function createTiptapSubmitSpy(): TiptapSubmitSpy {
  return vi.fn() as unknown as TiptapSubmitSpy;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  focusRef = React.createRef<TiptapComposerHandle>();
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

async function mount(
  onSubmit: TiptapSubmitSpy,
  options: Record<string, unknown> = {},
  seedDraft = true,
) {
  const { enterKey = "send", ...composerOptions } = options as {
    enterKey?: ComposerEnterKey;
  } & Record<string, unknown>;
  function Harness() {
    const runtime = useLocalRuntime(emptyChatModelAdapter);
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <TooltipProvider>
          <ComposerEnterKeyContext.Provider value={enterKey}>
            <TiptapComposer
              {...(composerOptions as Partial<TiptapComposerProps>)}
              focusRef={focusRef}
              onSubmit={onSubmit}
              placeholder="Ask the agent..."
              includeDefaultSlashSkills={false}
              plusMenuMode="hidden"
              voiceEnabled={false}
            />
          </ComposerEnterKeyContext.Provider>
        </TooltipProvider>
      </AssistantRuntimeProvider>
    );
  }

  await act(async () => root.render(<Harness />));
  if (seedDraft) {
    act(() => focusRef.current?.setText("Enter policy draft"));
  }
  return container.querySelector<HTMLElement>(".agent-composer-prosemirror")!;
}

async function press(editor: HTMLElement, options: KeyboardEventInit = {}) {
  await act(async () => {
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        ...options,
      }),
    );
  });
}

describe("TiptapComposer Enter policy", () => {
  it("submits with bare Enter and leaves modified Enter for text editing in plain mode", async () => {
    const onSubmit = createTiptapSubmitSpy();
    const editor = await mount(onSubmit, { enterSubmitMode: "plain" });

    await press(editor);
    expect(onSubmit).toHaveBeenCalledOnce();

    for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) {
      const modifiedSubmit = createTiptapSubmitSpy();
      const modifiedEditor = await mount(modifiedSubmit, {
        enterSubmitMode: "plain",
      });
      await press(modifiedEditor, { [modifier]: true });
      expect(modifiedSubmit, `${modifier}+Enter`).not.toHaveBeenCalled();
      expect(modifiedEditor.textContent).toContain("Enter policy draft");
      await act(async () => root.render(<></>));
    }
  });

  it("still submits with the platform modifier when plain mode is combined with newline-on-Enter", async () => {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    const modifier = isMac ? "metaKey" : "ctrlKey";
    const other = isMac ? "ctrlKey" : "metaKey";

    const submit = createTiptapSubmitSpy();
    const editor = await mount(submit, {
      enterSubmitMode: "plain",
      enterKey: "newline",
    });
    await press(editor, { [modifier]: true });
    expect(submit).toHaveBeenCalledOnce();
    await act(async () => root.render(<></>));

    const wrongModifier = createTiptapSubmitSpy();
    const wrongEditor = await mount(wrongModifier, {
      enterSubmitMode: "plain",
      enterKey: "newline",
    });
    await press(wrongEditor, { [other]: true });
    expect(wrongModifier).not.toHaveBeenCalled();
  });

  it("keeps Shift+Enter as a hard break and does not submit composing Enter", async () => {
    const onSubmit = createTiptapSubmitSpy();
    const editor = await mount(onSubmit, { enterSubmitMode: "plain" });

    await press(editor, { shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(editor.querySelectorAll("br").length).toBeGreaterThan(0);

    await press(editor, { isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the existing submission gate in plain mode", async () => {
    const onSubmit = createTiptapSubmitSpy();
    const editor = await mount(onSubmit, {
      enterSubmitMode: "plain",
      submissionDisabled: true,
    });

    await press(editor);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(editor.textContent).toContain("Enter policy draft");
  });

  it("submits only for the generated Enter inputs that plain mode accepts", async () => {
    for (const [index, row] of enterPolicyOracleCases.entries()) {
      const onSubmit = createTiptapSubmitSpy();
      const editor = await mount(
        onSubmit,
        { enterSubmitMode: "plain", draftScope: `oracle-input-${index}` },
        !row.input.draftEmpty,
      );

      expect(editor.textContent?.trim(), `oracle draft ${index}`).toBe(
        row.input.draftEmpty ? "" : "Enter policy draft",
      );
      await press(editor, row.input);
      expect(onSubmit, `oracle input ${index}`).toHaveBeenCalledTimes(
        row.expectedSubmitCount,
      );
      await act(async () => root.render(<></>));
    }
  });

  it("forwards the plain policy through PromptComposer", async () => {
    const onSubmit = vi.fn() as unknown as ReturnType<typeof vi.fn> &
      PromptComposerProps["onSubmit"];
    await act(async () => {
      root.render(
        <PromptComposer
          onSubmit={onSubmit}
          initialText="Prompt boundary draft"
          initialTextKey="enter-policy"
          draftScope="enter-policy"
          enterSubmitMode="plain"
          showModelSelector={false}
          modelStatusChecksEnabled={false}
          includeDefaultMentionSearch={false}
          includeDefaultSlashSkills={false}
          voiceEnabled={false}
        />,
      );
    });
    const editor = container.querySelector<HTMLElement>(".ProseMirror")!;

    await press(editor, { altKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(editor.textContent).toContain("Prompt boundary draft");

    await press(editor);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("uses the latest policy without remounting the editor", async () => {
    const onSubmit = createTiptapSubmitSpy();
    function Harness({ mode }: { mode: "default" | "plain" }) {
      const runtime = useLocalRuntime(emptyChatModelAdapter);
      return (
        <AssistantRuntimeProvider runtime={runtime}>
          <TooltipProvider>
            <TiptapComposer
              enterSubmitMode={mode}
              focusRef={focusRef}
              onSubmit={onSubmit}
              placeholder="Ask the agent..."
              includeDefaultSlashSkills={false}
              plusMenuMode="hidden"
              voiceEnabled={false}
            />
          </TooltipProvider>
        </AssistantRuntimeProvider>
      );
    }

    await act(async () => root.render(<Harness mode="plain" />));
    act(() => focusRef.current?.setText("Rerender policy draft"));
    const originalEditor = container.querySelector(
      ".agent-composer-prosemirror",
    );
    await press(originalEditor as HTMLElement, { altKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => root.render(<Harness mode="default" />));
    expect(container.querySelector(".agent-composer-prosemirror")).toBe(
      originalEditor,
    );
    await press(originalEditor as HTMLElement, { altKey: true });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("keeps the generic default behavior for callers without the opt-in", async () => {
    const onSubmit = createTiptapSubmitSpy();
    const editor = await mount(onSubmit);

    await press(editor, { altKey: true });
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
